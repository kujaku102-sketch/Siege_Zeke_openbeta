import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runVictoryE2E } from "./e2e-victory.mjs";
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const victoryMode = args.includes("--victory");
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--victory" && argument !== "--playwright-module" && index !== playwrightFlag + 1) ?? "http://127.0.0.1:4173/";

async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE for the external browser runner");
  const specifier = explicitPlaywrightModule.startsWith("file:") ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith("file:") || !existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}

async function startMode(page, mode) {
  await clickEntryControl(page, `[data-mode="${mode}"]`);
}

async function advanceTutorialIntroduction(page) {
  for (let index = 0; index < 7; index += 1) {
    const guide = page.locator(".live-guide");
    await guide.waitFor({ state: "visible" });
    const step = await guide.getAttribute("data-tutorial-step");
    const speaker = (await guide.locator(".live-guide-cast strong").textContent())?.trim();
    const visibleText = await guide.innerText();
    if (step !== `intro:${index}` || speaker !== "じぐさぽ") throw new Error(`tutorial introduction mismatch: ${JSON.stringify({ index, step, speaker })}`);
    if (/\bTUTORIAL\b|\bFOCUS\b/.test(visibleText)) throw new Error(`temporary tutorial label remained: ${visibleText}`);
    if (index === 3 && (await guide.locator("ruby rt").textContent())?.trim() !== "ベータテスト") throw new Error("tutorial beta ruby is missing");
    await guide.locator('[data-action="dismiss-tutorial-overlay"]').click();
  }
}

async function tutorialFocusLabels(page) {
  return page.locator(".live-focus[data-tutorial-focus-label]").evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.tutorialFocusLabel))]);
}

const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const base = new URL(url);
base.searchParams.delete("e2e");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

if (victoryMode) {
  try { await runVictoryE2E({ page, base }); }
  finally { await browser.close(); }
  process.exit(0);
}

try {
  const manifestResponse = await page.request.get(new URL("release-manifest.json", base).toString());
  if (!manifestResponse.ok()) throw new Error(`public release manifest is unavailable: ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  if (manifest.release?.environment !== "staging" || manifest.release?.productionApproved !== false) throw new Error("public release boundary is invalid");
  if (manifest.publicCardPool?.cardCount !== 214 || new Set(manifest.publicCardPool.canonicalIds).size !== 214) throw new Error("public release card pool is invalid");
  const [pwaManifestResponse, serviceWorkerResponse] = await Promise.all([page.request.get(new URL("manifest.webmanifest", base).toString()), page.request.get(new URL("sw.js", base).toString())]);
  if (!pwaManifestResponse.ok() || !serviceWorkerResponse.ok()) throw new Error("PWA manifest or service worker is unavailable");
  const pwaManifest = await pwaManifestResponse.json();
  if (pwaManifest.display !== "standalone" || pwaManifest.orientation !== "landscape" || pwaManifest.icons?.length < 2) throw new Error("PWA install contract is invalid");

  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker?.getRegistration?.()));
  if (await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__ !== undefined)) throw new Error("public build exposes a hidden E2E hook");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator('[data-mode="tutorial"], [data-mode="ai"], [data-mode="sandbox"], [data-deck-open]').count() !== 4) throw new Error("R2 entry does not expose the four primary routes");

  await startMode(page, "tutorial");
  await advanceTutorialIntroduction(page);
  const guide = page.locator(".live-guide");
  const guideAudit = await guide.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const image = node.querySelector(".live-guide-cast img");
    return { step: node.dataset.tutorialStep, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, speaker: node.querySelector("strong")?.textContent?.trim(), text: node.querySelector(".live-guide-text")?.textContent?.trim() };
  });
  const basicsZeroLabels = await tutorialFocusLabels(page);
  if (guideAudit.step !== "basics:0" || guideAudit.left < 0 || guideAudit.top < 0 || guideAudit.right > guideAudit.viewportWidth || guideAudit.bottom > guideAudit.viewportHeight || guideAudit.imageWidth !== 1081 || guideAudit.imageHeight !== 1280 || guideAudit.speaker !== "じぐさぽ" || !guideAudit.text || !basicsZeroLabels.includes("開始") || !basicsZeroLabels.includes("自分のDoors ZX")) throw new Error(`desktop live tutorial guide is invalid: ${JSON.stringify({ guideAudit, basicsZeroLabels })}`);
  await page.locator('[data-action="tutorial-advance"]').click();
  if (await guide.getAttribute("data-tutorial-step") !== "basics:1") throw new Error("tutorial did not advance to basics:1");
  const basicsOneLabels = await tutorialFocusLabels(page);
  if (!basicsOneLabels.includes("こそ泥") || !basicsOneLabels.includes("レジストリ")) throw new Error(`tutorial focus did not follow basics:1: ${basicsOneLabels.join(", ")}`);

  await page.locator('[data-live="options"]').click();
  await page.locator("[data-deck-open]").click();
  const deckThumbnail = await page.locator('[data-deck-card-id="STD-075"] .deck-card-thumbnail').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { art: node.classList.contains("has-art") && Boolean(node.querySelector(".deck-card-art")), ratio: rect.width / rect.height, name: node.querySelector(".deck-card-thumbnail-name")?.textContent?.trim() };
  });
  if (!deckThumbnail.art || deckThumbnail.ratio < 1.8 || deckThumbnail.name !== "ジャンキー") throw new Error(`desktop deck thumbnail is invalid: ${JSON.stringify(deckThumbnail)}`);
  await page.locator("[data-deck-close]").click();

  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await startMode(page, "ai");
  if (!await page.locator(".r2-board").count() || !await page.locator(".r2-console").count() || !await page.locator(".r2-hand").count()) throw new Error("AI mode did not mount the separated board, console and hand layers");
  await page.locator('[data-action="end-turn"]').click();
  await page.waitForFunction(() => /TURN 3 \/ YOU/.test(document.querySelector(".r2-console")?.textContent ?? "") && !/CPU処理中/.test(document.querySelector(".r2-console")?.textContent ?? ""), null, { timeout: 10000 });

  const mobilePage = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await mobilePage.addInitScript(() => Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true }));
  const mobileUrl = new URL("mobile/", base);
  await mobilePage.goto(mobileUrl.toString(), { waitUntil: "networkidle" });
  await mobilePage.waitForFunction(async () => (await caches.keys()).includes("sz-pwa-meta"));
  await startMode(mobilePage, "tutorial");
  const mobileGuide = mobilePage.locator(".live-guide");
  const mobileGuideAudit = await mobileGuide.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, speechPointerEvents: getComputedStyle(node.querySelector(".live-guide-speech")).pointerEvents };
  });
  if (mobileGuideAudit.left < 0 || mobileGuideAudit.top < 0 || mobileGuideAudit.right > mobileGuideAudit.viewportWidth || mobileGuideAudit.bottom > mobileGuideAudit.viewportHeight || mobileGuideAudit.speechPointerEvents !== "none") throw new Error(`mobile guide is clipped or blocks board input: ${JSON.stringify(mobileGuideAudit)}`);
  await advanceTutorialIntroduction(mobilePage);
  const startButton = mobilePage.locator('[data-action="tutorial-advance"]');
  const startHit = await startButton.evaluate(node => { const rect = node.getBoundingClientRect(); return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest?.('[data-action="tutorial-advance"]') === node; });
  if (!startHit) throw new Error("mobile tutorial guide blocks the focused start action");

  await mobilePage.goto(mobileUrl.toString(), { waitUntil: "networkidle" });
  await startMode(mobilePage, "ai");
  await mobilePage.locator(".r2-hand [data-card-uid]").first().click();
  const detailAudit = await mobilePage.locator(".r2-detail").evaluate(node => ({ effect: Boolean(node.querySelector("[data-card-detail-text]")) && (node.querySelector("[data-card-detail-text]")?.textContent?.trim().length ?? 0) > 0, runtime: Boolean(node.querySelector(".runtime-detail-section")), inViewport: node.getBoundingClientRect().left >= 0 && node.getBoundingClientRect().right <= innerWidth }));
  if (!detailAudit.effect || !detailAudit.runtime || !detailAudit.inViewport || !await mobilePage.locator(".r2-popup").count()) throw new Error(`mobile card detail or operation popup is invalid: ${JSON.stringify(detailAudit)}`);
  await mobilePage.close();

  console.log(JSON.stringify({ environment: manifest.release.environment, revision: manifest.release.buildRevision, cardCount: manifest.publicCardPool.cardCount, entryRoutes: 4, liveTutorialGuide: true, tutorialFocus: true, deckBuilder: true, separatedLayers: true, pacedAiTurn: true, mobilePwa: true, mobileGuideClickThrough: true, mobileDetail: true, ok: true }));
} finally {
  await browser.close();
}
