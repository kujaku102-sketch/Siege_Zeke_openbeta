import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const keyboardMode = args.includes("--keyboard");
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--keyboard" && argument !== "--playwright-module" && index !== playwrightFlag + 1) ?? "http://127.0.0.1:4173/";
const evidenceRoot = path.resolve("docs/ui-upgrade/evidence/UI-017");
const INTRO_TEXTS = [
  "初めまして。Siege÷Zeke(ジーグ)の世界へようこそ。私は『じぐさぽ』です。",
  "人間様……いえ、ユーザー様のサポートを仰せつかっております。どうぞよろしく。",
  "早速ですが、Siege÷Zekeについてお伝えすることがございます……",
  "現在、ここは世界Ver0.9.1",
  "なので、不可思議なことや思い通りにならないことが多々あると思われます",
  "産まれるまで優しく見守ってください！",
  "それでは参りましょう、オープンソースTCGの世界へ！"
];

async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE");
  const specifier = explicitPlaywrightModule.startsWith("file:") ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith("file:") || !existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}

async function clickVisible(page, selector) {
  const matches = page.locator(selector);
  if (keyboardMode) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      await page.keyboard.press("Tab");
      const focused = await matches.evaluateAll((nodes) => nodes.some((node) => node === document.activeElement && node.getClientRects().length > 0));
      if (!focused) continue;
      const focusVisible = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement);
        return Number.parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none";
      });
      if (!focusVisible) throw new Error(`keyboard focus is not visible: ${selector}`);
      await page.keyboard.press("Enter");
      return;
    }
    throw new Error(`keyboard target is not reachable by Tab: ${selector}`);
  }
  if (selector === '[data-mode="tutorial"]') return clickEntryControl(page, selector);
  for (let index = 0; index < await matches.count(); index += 1) {
    const candidate = matches.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`visible target is unavailable: ${selector}`);
}

async function selectCard(page, cardId, zone) {
  for (let step = 0; step < 3 && await page.locator(".r2-popup").count(); step += 1) await clickVisible(page, '[data-live="cancel"]');
  if (await page.locator('[data-live="close-detail"]').count()) await clickVisible(page, '[data-live="close-detail"]');
  const handToggle = page.locator('[data-live="hand"]');
  if (zone !== "hand" && await handToggle.count() && (await handToggle.textContent())?.includes("畳む")) await handToggle.click();
  const selector = `[data-card-id="${cardId}"][data-owner="player"][data-zone="${zone}"]`;
  const card = page.locator(selector).first();
  if (!await card.isVisible() && zone === "hand") {
    await clickVisible(page, "[data-mobile-hand-toggle]");
  }
  await card.scrollIntoViewIfNeeded();
  await clickVisible(page, selector);
}

async function assertStep(page, key, expectedLabels = []) {
  const dialogueLocator = page.locator(".live-guide");
  try {
    await dialogueLocator.waitFor({ state: "visible" });
  } catch (error) {
    const state = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__?.getState?.());
    throw new Error(`tutorial dialogue is unavailable at ${key}: ${JSON.stringify({ active: state?.active, pending: state?.pending, selectedUid: state?.selectedUid, log: state?.log?.slice(-5) })}`, { cause: error });
  }
  const value = await dialogueLocator.getAttribute("data-tutorial-step") ?? "";
  if (value !== key) throw new Error(`tutorial step mismatch: expected ${key}, received ${value}`);
  const dialogue = await dialogueLocator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  if (dialogue.left < 0 || dialogue.top < 0 || dialogue.right > dialogue.width || dialogue.bottom > dialogue.height) {
    throw new Error(`tutorial dialogue is outside the viewport at ${key}: ${JSON.stringify(dialogue)}`);
  }
  const labels = await page.locator(".live-focus[data-tutorial-focus-label]").evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.tutorialFocusLabel))]);
  for (const label of expectedLabels) {
    if (!labels.includes(label)) {
      await page.screenshot({ path: path.join(evidenceRoot, `failure-${key.replace(":", "-")}.png`), fullPage: true });
      throw new Error(`tutorial focus is missing at ${key}: ${label}; found ${labels.join(", ")}`);
    }
  }
  return labels;
}

async function advanceIntroduction(page) {
  for (let index = 0; index < INTRO_TEXTS.length; index += 1) {
    const dialogue = page.locator(".live-guide");
    await dialogue.waitFor({ state: "visible" });
    const key = await dialogue.getAttribute("data-tutorial-step");
    const speaker = (await dialogue.locator(".live-guide-cast strong").textContent())?.trim();
    const text = (await dialogue.locator(".live-guide-text").textContent())?.trim() ?? "";
    if (key !== `intro:${index}` || speaker !== "じぐさぽ" || !text.includes(INTRO_TEXTS[index])) {
      throw new Error(`tutorial introduction mismatch: ${JSON.stringify({ index, key, speaker, text })}`);
    }
    const visibleCopy = await dialogue.innerText();
    if (/\bTUTORIAL\b|\bFOCUS\b/.test(visibleCopy)) throw new Error(`temporary English label remained: ${visibleCopy}`);
    if (index === 3 && (await dialogue.locator("ruby rt").textContent())?.trim() !== "ベータテスト") {
      throw new Error("tutorial introduction ruby is missing");
    }
    await clickVisible(page, '[data-action="dismiss-tutorial-overlay"]');
  }
}

async function assertPostCompletionEndTurn(page, label) {
  const before = await page.evaluate(() => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return { active: state.active, turnNumber: state.turnNumber };
  });
  await clickVisible(page, '[data-action="end-turn"]');
  const after = await page.evaluate(() => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return { active: state.active, turnNumber: state.turnNumber };
  });
  if (before.active === after.active && before.turnNumber === after.turnNumber) {
    throw new Error(`${label} tutorial remained locked after completion: ${JSON.stringify({ before, after })}`);
  }
}

async function dock(page) {
  if (!await page.locator(".live-guide").isVisible()) throw new Error("tutorial guide disappeared before the required action");
}

async function playToZone(page, zone) {
  await clickVisible(page, '[data-live="execute"]');
  await clickAvailableSlot(page, zone);
}

async function clickAvailableSlot(page, zone) {
  if (keyboardMode) return clickVisible(page, `[data-live-slot^="${zone}:"]`);
  const slots = page.locator(`[data-live-slot^="${zone}:"]`);
  const hits = await slots.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { key: node.dataset.liveSlot, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, hit: hit?.className ?? hit?.tagName ?? null, available: hit?.closest?.("[data-live-slot]") === node,
      board: node.closest(".r2-board")?.className, slot: node.parentElement?.className, pointer: getComputedStyle(node).pointerEvents,
      hitPointer: hit ? getComputedStyle(hit).pointerEvents : null, hitZone: hit?.closest?.(".zone")?.className ?? null };
  }));
  const key = hits.find(item => item.available)?.key;
  if (!key) {
    const guide = await page.locator(".live-guide").evaluate(node => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; });
    throw new Error(`no unobstructed ${zone} placement slot is available: ${JSON.stringify({ hits, guide })}`);
  }
  await page.locator(`[data-live-slot="${key}"]`).click();
}

async function selectTutorial(page, tutorialId) {
  await clickVisible(page, '[data-live="options"]');
  await page.locator("[data-tutorial-select]").selectOption(tutorialId);
}

async function finishPending(page, { preferEmptySelection = false } = {}) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const trigger = page.locator("[data-trigger-item]:not([disabled])").first();
    if (await trigger.count()) { await trigger.click(); continue; }
    if (await page.locator('[data-action="dismiss-thread"]').count()) { await clickVisible(page, '[data-action="dismiss-thread"]'); continue; }
    if (await page.locator('[data-action="place-junk-back"]').count()) { await clickVisible(page, '[data-action="place-junk-back"]'); continue; }
    if (await page.locator('[data-action="lucky-no"]').count()) { await clickVisible(page, '[data-action="lucky-no"]'); continue; }
    if (await page.locator(".selection-panel").count()) {
      const label = (await page.locator(".selection-panel h2").textContent())?.trim() ?? "";
      const firstOption = page.locator("[data-selection-option]").first();
      if (!preferEmptySelection && await firstOption.count()) await firstOption.click();
      if (label.includes("追加効果") || await page.locator('[data-action="confirm-selection"]:not([disabled])').count()) {
        await clickVisible(page, '[data-action="confirm-selection"]');
        continue;
      }
    }
    if (await page.locator('[data-action="access-drag-front"]').count()) { await clickVisible(page, '[data-action="access-drag-front"]'); continue; }
    return;
  }
  throw new Error("pending resolution did not settle within 20 browser actions");
}

async function runBasics(page, label) {
  await advanceIntroduction(page);
  await assertStep(page, "basics:0", ["開始", "自分のDoors ZX"]);
  await clickVisible(page, '[data-action="tutorial-advance"]');
  await assertStep(page, "basics:1", ["こそ泥", "レジストリ"]);
  await dock(page);
  await selectCard(page, "STD-076", "hand");
  await clickVisible(page, '[data-action="install"]');

  await assertStep(page, "basics:2", ["ジャンキー", "自分フロント"]);
  await dock(page);
  await selectCard(page, "STD-075", "hand");
  await playToZone(page, "front");

  await assertStep(page, "basics:3", ["ジャンキー", "相手ユーザー"]);
  await dock(page);
  await selectCard(page, "STD-075", "front");
  await clickVisible(page, '[data-action="prepare-attack"]');
  await clickVisible(page, '[data-fortress="ai"]');

  await assertStep(page, "basics:4", ["ジャンキー", "ターン終了"]);
  await dock(page);
  await clickVisible(page, '[data-action="end-turn"]');

  await assertStep(page, "basics:5", ["カネコ", "自分フロント", "華守り"]);
  await dock(page);
  await selectCard(page, "STD-090", "hand");
  await playToZone(page, "front");
  await finishPending(page);

  await assertStep(page, "basics:6", ["カネコ", "ターン終了"]);
  await dock(page);
  await clickVisible(page, '[data-action="end-turn"]');

  await assertStep(page, "basics:7", ["カネコ", "セキュリティ", "攻撃宣言先"]);
  await dock(page);
  await selectCard(page, "STD-090", "front");
  await clickVisible(page, '[data-action="prepare-attack"]');
  await clickVisible(page, '[data-fortress="ai"]');

  await assertStep(page, "basics:8", ["ラッキー☆ショット", "華守り"]);
  await dock(page);
  await selectCard(page, "STD-086", "hand");
  await clickVisible(page, '[data-action="play-front"]');
  await clickVisible(page, '[data-card-id="STD-131"][data-owner="ai"][data-zone="front"]');
  await clickVisible(page, '[data-action="confirm-selection"]');
  await finishPending(page, { preferEmptySelection: true });
  const state = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
  if (state.mode !== "sandbox" || state.pending || !state.players.player.trash.some((card) => card.id === "STD-086")) {
    throw new Error(`${label} basics did not finish its required optional choice`);
  }
  await page.screenshot({ path: path.join(evidenceRoot, `${label}-basics-complete.png`), fullPage: true });
  await assertPostCompletionEndTurn(page, `${label} basics`);
  return 10;
}

async function runVengeance(page, label) {
  await selectTutorial(page, "vengeance");
  await advanceIntroduction(page);
  await assertStep(page, "vengeance:0", ["開始", "ドールズ2体"]);
  await clickVisible(page, '[data-action="tutorial-advance"]');

  await assertStep(page, "vengeance:1", ["淫魔像", "レジストリ"]);
  await dock(page);
  await selectCard(page, "STD-191", "hand");
  await clickVisible(page, '[data-action="install"]');

  await assertStep(page, "vengeance:2", ["トライプビア", "素材ドールズ", "自分フロント"]);
  await dock(page);
  await selectCard(page, "STD-195", "hand");
  await clickVisible(page, '[data-action="layered-front"]');
  if ((await page.locator('[data-live="hand"]').textContent())?.includes("畳む")) await page.locator('[data-live="hand"]').click();
  const dolls = page.locator('[data-card-id="STD-189"][data-owner="player"][data-zone="front"]');
  if (await dolls.count() !== 2) throw new Error(`${label} vengeance does not expose exactly two tutorial materials`);
  if (keyboardMode) {
    const dollUids = await dolls.evaluateAll((nodes) => nodes.map((node) => node.dataset.cardUid));
    for (const uid of dollUids) await clickVisible(page, `[data-card-uid="${uid}"]`);
  } else {
    await dolls.nth(0).click();
    await dolls.nth(1).click();
  }
  await clickVisible(page, '[data-action="confirm-layered"]');
  if (await page.locator('[data-live-slot^="front:"]').count()) await clickAvailableSlot(page, "front");

  await assertStep(page, "vengeance:3", ["トライプビア", "自分バック"]);
  await dock(page);
  await selectCard(page, "STD-195", "front");
  await clickVisible(page, '[data-action="relog-back"]');
  if (label === "desktop" || label.includes("zoom-200")) {
    await clickVisible(page, '[data-live="cancel"]');
    const cancelled = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
    if (cancelled.pending || !cancelled.players.player.front.some((card) => card.id === "STD-195")) {
      throw new Error("cancelling a deferred tutorial choice did not restore the pre-action state");
    }
    const restoredTripvia = cancelled.players.player.front.find((card) => card.id === "STD-195");
    if (cancelled.selectedUid !== restoredTripvia.uid) await selectCard(page, "STD-195", "front");
    await clickVisible(page, '[data-action="relog-back"]');
  }
  if (await page.locator('[data-live-slot^="back:"]').count()) await clickAvailableSlot(page, "back");
  await page.locator("[data-selection-scope]").selectOption("レイヤー1枚を破棄して1メモリ");
  await clickVisible(page, '[data-action="confirm-selection"]');
  await finishPending(page);

  await assertStep(page, "vengeance:4", ["アクロィア", "自分フロント"]);
  await dock(page);
  await selectCard(page, "STD-194", "hand");
  await playToZone(page, "front");

  await assertStep(page, "vengeance:5", ["タナフォリア", "自分フロント"]);
  await dock(page);
  await selectCard(page, "STD-192", "hand");
  await playToZone(page, "front");

  await assertStep(page, "vengeance:6", ["タナフォリア", "アクロィア", "移動先バック"]);
  await dock(page);
  await selectCard(page, "STD-192", "front");
  await clickVisible(page, '[data-action="activate-effect"]');
  await clickVisible(page, "[data-effect-id]");
  await clickVisible(page, '[data-card-id="STD-194"][data-owner="player"][data-zone="front"]');
  await clickVisible(page, '[data-action="confirm-selection"]');
  await clickVisible(page, '[data-action="effect-move-back"]');

  const state = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
  const tripvia = state.players.player.back.find((card) => card.id === "STD-195");
  const acroia = state.players.player.back.find((card) => card.id === "STD-194");
  const discardedDoll = state.players.player.trash.some((card) => card.id === "STD-189");
  const revealedDoll = state.players.player.front.some((card) => card.id === "STD-189");
  if (state.mode !== "sandbox" || state.pending || !tripvia || tripvia.mounted.length !== 1 || !acroia || !discardedDoll || !revealedDoll || state.players.player.hand.length < 2) {
    throw new Error(`${label} vengeance final state is invalid: ${JSON.stringify({ pending: state.pending, back: state.players.player.back.map((card) => ({ id: card.id, layers: card.mounted.length })), hand: state.players.player.hand.length })}`);
  }
  await page.screenshot({ path: path.join(evidenceRoot, `${label}-vengeance-complete.png`), fullPage: true });
  await assertPostCompletionEndTurn(page, `${label} vengeance`);
  return 8;
}

const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ channel: "msedge", headless: true });
mkdirSync(evidenceRoot, { recursive: true });
const runs = [];
try {
  const profiles = keyboardMode ? [
    { label: "desktop-keyboard", viewport: { width: 1600, height: 1000 }, tutorials: ["basics"] },
    // A 640x360 CSS viewport is the layout viewport produced by 1280x720 at 200% browser zoom.
    { label: "zoom-200-equivalent-keyboard", viewport: { width: 640, height: 360 }, tutorials: ["vengeance"] }
  ] : [
    { label: "desktop", viewport: { width: 1600, height: 1000 } },
    { label: "mobile-landscape", viewport: { width: 844, height: 390 } }
  ];
  for (const profile of profiles) {
    for (const tutorial of profile.tutorials ?? ["basics", "vengeance"]) {
      const page = await browser.newPage({ viewport: profile.viewport });
      const target = new URL(url);
      target.searchParams.set("e2e", "1");
      await page.goto(target.toString(), { waitUntil: "networkidle" });
      await page.locator("#boot-splash").waitFor({ state: "detached", timeout: 15000 });
      await clickVisible(page, '[data-mode="tutorial"]');
      const steps = tutorial === "basics" ? await runBasics(page, profile.label) : await runVengeance(page, profile.label);
      runs.push({ viewport: profile.label, tutorial, steps, ok: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ runs, input: keyboardMode ? "keyboard-only" : "pointer", focusCleanup: true, internalChoices: true, ok: true }));
