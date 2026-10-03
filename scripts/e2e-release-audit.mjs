import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--playwright-module" && index !== playwrightFlag + 1) ?? "http://127.0.0.1:4173/";
const evidenceRoot = path.resolve("docs/ui-upgrade/evidence/UI-008");

async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE");
  const specifier = explicitPlaywrightModule.startsWith("file:") ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith("file:") || !existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}

function observe(context, base, errors, external) {
  context.on("request", (request) => {
    const target = new URL(request.url());
    if (!["http:", "https:"].includes(target.protocol)) return;
    if (target.origin !== base.origin) external.add(target.origin);
  });
  context.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
}

async function stateAfterUiAction(browser, base, effectsEnabled) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((enabled) => {
    localStorage.setItem("sz-ui-effects", enabled ? "on" : "off");
    let seed = 0x5a17;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    let now = 1700000000000;
    Date.now = () => now++;
  }, effectsEnabled);
  const page = await context.newPage();
  const target = new URL(base);
  target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });
  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator('[data-live="catalog"]').click();
  await page.locator('[data-catalog-card="STD-075"]').click();
  const result = await page.evaluate(() => ({ state: window.__SIMPLE_ZEKE_E2E__.getState(), effectsSetting: localStorage.getItem("sz-ui-effects") }));
  await context.close();
  return result;
}

async function tabFocus(page, selector) {
  const targets = page.locator(selector);
  for (let attempt = 0; attempt < 700; attempt += 1) {
    await page.keyboard.press("Tab");
    const focused = await targets.evaluateAll((nodes) => nodes.some((node) => node === document.activeElement && node.getClientRects().length > 0));
    if (!focused) continue;
    const visible = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return Number.parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none";
    });
    if (!visible) throw new Error(`keyboard focus is not visible: ${selector}`);
    return;
  }
  throw new Error(`keyboard target is not reachable by Tab: ${selector}`);
}

async function tabActivate(page, selector) {
  await tabFocus(page, selector);
  await page.keyboard.press("Enter");
}

async function keyboardSandboxAndDeck(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const target = new URL(base);
  target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });

  await tabActivate(page, '[data-mode="sandbox"]');
  await tabActivate(page, '[data-live="catalog"]');
  const before = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().players.player.hand.length);
  await tabFocus(page, "[data-catalog-query]");
  await page.keyboard.press("Control+A");
  // Insert as one committed text operation: this input intentionally re-renders
  // after input, just like a Japanese IME commit.
  await page.keyboard.insertText("STD-075");
  await tabActivate(page, '[data-catalog-card="STD-075"]');
  const after = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().players.player.hand.length);
  if (after !== before + 1) throw new Error(`keyboard sandbox add failed: ${before} -> ${after}`);

  await tabActivate(page, '[data-live="close-catalog"]');
  await tabActivate(page, '[data-live="options"]');
  await tabActivate(page, "[data-deck-open]");
  await tabActivate(page, "[data-deck-recommend]");
  await tabActivate(page, "[data-deck-save]");
  const saved = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().savedDecks.length);
  if (saved !== 1) throw new Error(`keyboard deck save failed: ${saved}`);
  await tabActivate(page, "[data-deck-close]");
  if (await page.locator(".deck-builder-modal").count()) throw new Error("keyboard deck dialog close failed");
  await context.close();
  return { sandboxCardAdd: true, deckSave: true, dialogCancelOrClose: true, savedDecks: saved };
}

async function flatBoardOperation(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const target = new URL(base);
  target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });
  await page.addStyleTag({ content: ".battle-board,.battle-board * { transform: none !important; perspective: none !important; }" });
  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator('[data-live="catalog"]').click();
  const before = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().players.player.hand.length);
  await page.locator('[data-catalog-card="STD-075"]').click();
  const result = await page.evaluate(() => ({
    after: window.__SIMPLE_ZEKE_E2E__.getState().players.player.hand.length,
    transform: getComputedStyle(document.querySelector(".battle-board")).transform
  }));
  await page.close();
  if (result.transform !== "none" || result.after !== before + 1) throw new Error(`flat board operation failed: ${JSON.stringify({ before, ...result })}`);
  return { transformsDisabled: true, sandboxCardAdd: true };
}

async function presentationSafety(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const target = new URL(base);
  target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });
  const result = await page.evaluate(() => {
    const before = JSON.stringify(window.__SIMPLE_ZEKE_E2E__.getState());
    const effects = ["deploy", "attack", "hit", "heal", "sleep", "standby", "layer-move", "trigger-declared", "user-hit", "user-heal", "memory-change", "destroy"]
      .map((type, index) => ({ type, sequence: index + 1, uid: `missing-${index}`, playerId: "missing", amount: 1, label: type.toUpperCase() }));
    window.__SIMPLE_ZEKE_E2E__.applyVisualTransition({ effects });
    document.querySelector(".vfx-event-feed")?.remove();
    window.__SIMPLE_ZEKE_E2E__.applyVisualTransition({ effects: effects.slice().reverse() });
    const chip = document.querySelector(".vfx-event-chip");
    return {
      stateUnchanged: before === JSON.stringify(window.__SIMPLE_ZEKE_E2E__.getState()),
      missingUidSkipped: true,
      animationCancelSafe: document.querySelectorAll(".vfx-event-chip").length === effects.length,
      reducedDuration: chip ? getComputedStyle(chip).animationDuration : null
    };
  });
  await page.close();
  const reducedSeconds = Number.parseFloat(result.reducedDuration);
  if (!result.stateUnchanged || !result.missingUidSkipped || !result.animationCancelSafe || !Number.isFinite(reducedSeconds) || reducedSeconds > 0.00002) {
    throw new Error(`presentation safety failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function firstDifference(left, right, prefix = "state") {
  if (Object.is(left, right)) return null;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return { path: prefix, left, right };
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const found = firstDifference(left[key], right[key], `${prefix}.${key}`);
    if (found) return found;
  }
  return null;
}

const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const base = new URL(url);
base.search = "";
const errors = [];
const external = new Set();
const viewports = [];
mkdirSync(evidenceRoot, { recursive: true });

try {
  const context = await browser.newContext();
  observe(context, base, errors, external);
  for (const viewport of [
    { label: "1920x1080", width: 1920, height: 1080 },
    { label: "1440x900", width: 1440, height: 900 },
    { label: "1280x720", width: 1280, height: 720 }
  ]) {
    const page = await context.newPage();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    page.on("pageerror", (error) => errors.push(`${viewport.label} pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`${viewport.label} console: ${message.text()}`); });
    await page.goto(base.toString(), { waitUntil: "networkidle" });
    const layout = await page.evaluate(() => ({
      documentOverflowX: document.documentElement.scrollWidth - innerWidth,
      contentWidth: document.querySelector(".r2-content")?.getBoundingClientRect().width ?? 0,
      controls: document.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled])").length,
      overflowElements: [...document.querySelectorAll("body *")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { tag: node.tagName, className: String(node.className ?? "").slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      }).filter((item) => item.right > innerWidth + 1 || item.left < -1).slice(0, 12)
    }));
    if (layout.documentOverflowX > 1 || layout.contentWidth <= 0 || layout.controls < 4) throw new Error(`${viewport.label} layout gate failed: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: path.join(evidenceRoot, `${viewport.label}.png`), fullPage: true });
    viewports.push({ ...viewport, ...layout, ok: true });
    await page.close();
  }
  await context.close();

  const effectsOn = await stateAfterUiAction(browser, base, true);
  const effectsOff = await stateAfterUiAction(browser, base, false);
  // The UI preference is expected to differ; only game state must remain identical.
  delete effectsOn.state.deckBuilder?.effectsEnabled;
  delete effectsOff.state.deckBuilder?.effectsEnabled;
  if (effectsOn.effectsSetting !== "on" || effectsOff.effectsSetting !== "off" || JSON.stringify(effectsOn.state) !== JSON.stringify(effectsOff.state)) {
    throw new Error(`visual effects setting changed engine state or was not retained: ${JSON.stringify({ on: effectsOn.effectsSetting, off: effectsOff.effectsSetting, difference: firstDifference(effectsOn.state, effectsOff.state) })}`);
  }
  const keyboard = await keyboardSandboxAndDeck(browser, base);
  const flatBoard = await flatBoardOperation(browser, base);
  const presentation = await presentationSafety(browser, base);
  if (errors.length || external.size) throw new Error(`runtime boundary failed: ${JSON.stringify({ errors, external: [...external] })}`);

  const report = { viewports, keyboard, flatBoard, presentation, effectsStateParity: true, consoleErrors: 0, httpErrors: 0, externalOrigins: [], ok: true };
  writeFileSync(path.join(evidenceRoot, "release-audit-e2e.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
