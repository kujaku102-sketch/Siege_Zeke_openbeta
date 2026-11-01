// Ship check: the public build's boundary. Run by release:gate only.
//   release-manifest is staging and not production-approved; the card pool is the approved size (config/release.staging.json publicCardPool.cardCount)
//   and all ids are unique; the PWA manifest is installable (standalone, landscape, 2+ icons) and the service worker is served;
//   the public page has no test hook; loading the title makes no request to another origin, no HTTP error and no console error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openBrowser } from "../parts/browser.mjs";

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../../../config/release.staging.json", import.meta.url)), "utf8"));
const approved = config.publicCardPool.cardCount;
const { browser, base, errors } = await openBrowser();
const external = new Set();
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  context.on("request", (request) => { const target = new URL(request.url()); if (["http:", "https:"].includes(target.protocol) && target.origin !== base.origin) external.add(target.origin); });
  context.on("response", (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

  const manifestResponse = await page.request.get(new URL("release-manifest.json", base).toString());
  if (!manifestResponse.ok()) throw new Error(`public release manifest is unavailable: ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  if (manifest.release?.environment !== "staging" || manifest.release?.productionApproved !== false) throw new Error("public release boundary is invalid");
  const ids = manifest.publicCardPool?.canonicalIds ?? [];
  if (!Number.isInteger(approved) || manifest.publicCardPool?.cardCount !== approved || ids.length !== approved || new Set(ids).size !== approved) {
    throw new Error(`public release card pool is not the approved ${approved} unique cards (manifest says ${manifest.publicCardPool?.cardCount}, lists ${ids.length})`);
  }
  const [pwaManifestResponse, serviceWorkerResponse] = await Promise.all([page.request.get(new URL("manifest.webmanifest", base).toString()), page.request.get(new URL("sw.js", base).toString())]);
  if (!pwaManifestResponse.ok() || !serviceWorkerResponse.ok()) throw new Error("PWA manifest or service worker is unavailable");
  const pwaManifest = await pwaManifestResponse.json();
  if (pwaManifest.display !== "standalone" || pwaManifest.orientation !== "landscape" || pwaManifest.icons?.length < 2) throw new Error("PWA install contract is invalid");

  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker?.getRegistration?.()));
  if (await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__ !== undefined)) throw new Error("public build exposes a hidden E2E hook");
  if (errors.length || external.size) throw new Error(`runtime boundary failed: ${JSON.stringify({ errors, external: [...external] })}`);
  await context.close();
  console.log(JSON.stringify({ suite: "ship/boundary", approvedCardCount: approved, manifestStaging: true, pwaInstallable: true, noTestHook: true, externalOrigins: 0, consoleAndHttpErrors: 0, ok: true }));
} finally {
  await browser.close();
}
