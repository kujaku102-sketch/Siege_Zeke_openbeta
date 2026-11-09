// Ship check: the PWA cache. Run by release:gate only.
//   a normal browser tab makes no PWA cache; an installed one seeds the shell cache with exactly the manifest's count and no deploy-only files;
//   card art is cached only from the card-art allowlist; the shell loads offline; an old revision's caches are removed on update;
//   a shell seed that fails leaves nothing behind (atomic).
// The card whose art is cached is taken from the sandbox catalog on the page, not named here.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openBrowser, until } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";

const evidenceRoot = path.resolve("docs/ui-upgrade/evidence/UI-007");
const OLD_SHELL_CACHE = "sz-pwa-shell-old-revision";
const OLD_ART_CACHE = "sz-pwa-card-art-old-revision";

const cacheSnapshot = (page) => page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async (name) => {
  const cache = await caches.open(name);
  return [name, (await cache.keys()).map((request) => request.url)];
}))));

const messageWorker = (page, type, payload = {}) => page.evaluate(({ type, payload }) => new Promise((resolve, reject) => {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return reject(new Error("service worker controller is unavailable"));
  const channel = new MessageChannel();
  const timeout = setTimeout(() => reject(new Error(`${type} timed out`)), 5000);
  channel.port1.onmessage = (event) => { clearTimeout(timeout); resolve(event.data); };
  worker.postMessage({ type, ...payload }, [channel.port2]);
}), { type, payload });

const { browser, base, errors } = await openBrowser();
const report = { normalBrowser: false, installedOnline: false, offlineReload: false, cardArtAllowlist: false, oldCacheCleanup: false, atomicFailure: false };
try {
  const probe = await browser.newPage();
  const manifestResponse = await probe.request.get(new URL("release-manifest.json", base).toString());
  if (!manifestResponse.ok()) throw new Error(`release manifest unavailable: ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  await probe.close();
  const revision = manifest.release?.buildRevision;
  const shellName = `sz-pwa-shell-${revision}`;
  const artName = `sz-pwa-card-art-${revision}`;
  const shellCount = manifest.pwa?.shellAssetCount;
  if (!/^[a-f0-9]{16}$/.test(revision ?? "") || !Number.isInteger(shellCount)) throw new Error("release manifest has no valid PWA revision contract");

  const normalContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const normalPage = await normalContext.newPage();
  await normalPage.goto(base.toString(), { waitUntil: "networkidle" });
  await normalPage.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  const normalKeys = await normalPage.evaluate(() => caches.keys());
  if (normalKeys.some((name) => name.startsWith("sz-pwa-"))) throw new Error(`normal browser created PWA caches: ${normalKeys.join(", ")}`);
  report.normalBrowser = true;
  await normalContext.close();

  const installedContext = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await installedContext.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
  const page = await installedContext.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.pwaCache === "ready");
  let snapshot = await cacheSnapshot(page);
  if (!snapshot["sz-pwa-meta"] || snapshot[shellName]?.length !== shellCount) throw new Error(`installed cache seed is incomplete: ${JSON.stringify(snapshot)}`);
  if (snapshot[shellName].some((href) => /\/(?:_headers|_redirects)(?:\?|$)/.test(href))) throw new Error("deploy-only controls leaked into the shell cache");
  report.installedOnline = true;

  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.waitForFunction(() => document.documentElement.dataset.pwaCache === "ready");
  }

  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator("[data-runtime-menu]").click();
  await page.locator("[data-catalog-open]").click();
  const card = page.locator("[data-catalog-card]").first();
  const cardId = await card.getAttribute("data-catalog-card");
  await card.click();
  const cardArtUrl = await page.locator(`img[src*="${cardId}-"]`).first().getAttribute("src");
  if (!cardArtUrl) throw new Error(`${cardId} card art did not render`);
  const artReply = await messageWorker(page, "CACHE_CARD_ART", { urls: [cardArtUrl] });
  if (!artReply.ok) throw new Error(`card-art cache request failed: ${JSON.stringify(artReply)}`);
  snapshot = await cacheSnapshot(page);
  const artEntries = snapshot[artName] ?? [];
  if (!artEntries.length || artEntries.some((href) => !/\/assets\/(?:STD|SZTB)-\d{3}-[^/]+\.(?:png|jpe?g|webp)(?:\?|$)/i.test(href))) {
    throw new Error(`card-art cache contains a non-card asset: ${JSON.stringify(artEntries)}`);
  }
  report.cardArtAllowlist = true;

  const shellProbeUrl = snapshot[shellName].find((href) => href.endsWith(".js"));
  const shellProbe = await page.evaluate(async ({ shellName, shellProbeUrl }) => ({
    storageMatch: Boolean(await caches.match(shellProbeUrl, { cacheName: shellName })),
    directMatch: Boolean(await (await caches.open(shellName)).match(shellProbeUrl))
  }), { shellName, shellProbeUrl });
  if (!shellProbe.storageMatch || !shellProbe.directMatch) throw new Error(`shell cache cannot match its JS entry: ${JSON.stringify(shellProbe)}`);

  const offlineErrors = [];
  for (const worker of installedContext.serviceWorkers()) worker.on("console", (message) => offlineErrors.push(`worker console: ${message.text()}`));
  page.on("console", (message) => { if (message.type() === "error") offlineErrors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => offlineErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => offlineErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  await installedContext.setOffline(true);
  const offlineProbe = await page.evaluate(async (assetUrl) => {
    try { const response = await fetch(assetUrl); return { ok: response.ok, status: response.status, length: (await response.text()).length }; }
    catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
  }, shellProbeUrl);
  if (!offlineProbe.ok) offlineErrors.push(`direct offline shell fetch: ${JSON.stringify(offlineProbe)}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  try { await page.locator(".r2-content").waitFor({ state: "visible", timeout: 5000 }); }
  catch { throw new Error(`offline document did not load: ${JSON.stringify({ url: page.url(), title: await page.title(), errors: offlineErrors, caches: await cacheSnapshot(page).catch(() => ({})) })}`); }
  await page.waitForFunction(() => document.documentElement.dataset.pwaCache === "ready");
  snapshot = await cacheSnapshot(page);
  if (snapshot[shellName]?.length !== shellCount) throw new Error("offline reload damaged the current shell cache");
  report.offlineReload = true;

  await installedContext.setOffline(false);
  await page.evaluate(async ({ oldShell, oldArt }) => { await caches.open(oldShell); await caches.open(oldArt); }, { oldShell: OLD_SHELL_CACHE, oldArt: OLD_ART_CACHE });
  const unregistered = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).unregister());
  if (!unregistered) throw new Error("service worker update probe could not unregister the old revision");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForFunction(async () => !(await caches.keys()).some((name) => name.includes("old-revision")));
  report.oldCacheCleanup = true;

  await page.evaluate(async ({ shellName, artName }) => { await caches.delete("sz-pwa-meta"); await caches.delete(shellName); await caches.delete(artName); }, { shellName, artName });
  await installedContext.setOffline(true);
  const failure = await messageWorker(page, "ENABLE_PWA_CACHE");
  snapshot = await cacheSnapshot(page);
  if (failure.ok !== false || snapshot["sz-pwa-meta"] || snapshot[shellName]) throw new Error(`failed shell seed was not atomic: ${JSON.stringify({ failure, snapshot })}`);
  report.atomicFailure = true;
  await installedContext.setOffline(false);
  await installedContext.close();
  if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);

  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(path.join(evidenceRoot, "pwa-cache-e2e.json"), `${JSON.stringify({ revision, shellCount, ...report, ok: true }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ suite: "ship/pwa", revision, shellCount, ...report, ok: true }));
} finally {
  await browser.close();
}
