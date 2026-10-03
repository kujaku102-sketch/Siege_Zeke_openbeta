import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--playwright-module" && index !== playwrightFlag + 1) ?? "http://127.0.0.1:4173/";

async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE for the external browser runner");
  const specifier = explicitPlaywrightModule.startsWith("file:") ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}
const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function freshSandbox(ids) {
  const target = new URL(url); target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-mode="sandbox"]').click();
  for (const id of ids) {
    const catalog = page.locator(`[data-catalog-card="${id}"]`);
    if (await catalog.count() !== 1) throw new Error(`catalog card missing: ${id}`);
    await catalog.click();
  }
}

try {
  const ids = ["STD-048", "STD-086", "STD-124", "STD-142", "STD-159", "STD-131", "STD-020"];
  await freshSandbox(ids);
  const fixture = await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState();
    const player = state.players.player; const ai = state.players.ai;
    const take = (id) => player.hand.find((card) => card.id === id);
    const shot = take("STD-086"); const sacrifice = take("STD-020"); const victim = take("STD-131");
    player.hand = [shot]; player.front = [sacrifice]; player.back = [];
    ai.hand = []; ai.front = [victim]; ai.back = [];
    player.memory = 99; victim.permanentStr = 20;
    player.registry = [{ ...structuredClone(shot), uid: "e2e-red-symbol", id: "E2E-RED", category: "Code", mounted: [], faceDown: false }];
    state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state);
    return { shot: shot.uid, sacrifice: sacrifice.uid, victim: victim.uid };
  });
  await page.locator(`.hand [data-card-uid="${fixture.shot}"]`).click();
  await page.locator('[data-action="play-front"]').first().click();
  await page.locator(`[data-card-uid="${fixture.victim}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const beforeOptional = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
  if (beforeOptional.pending?.request?.continuation?.type !== "runtime-action-selection") throw new Error("STD-086 optional destruction window missing");
  if (beforeOptional.players.player.trash.some((card) => card.id === "STD-086")) throw new Error("STD-086 cleaned up before optional selection");
  await page.locator(`[data-card-uid="${fixture.sacrifice}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const afterOptional = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
  if (!afterOptional.players.player.trash.some((card) => card.id === "STD-086")) throw new Error("STD-086 cleanup missing after selection");
  if (afterOptional.players.ai.front[0]?.damage !== 3 || afterOptional.players.ai.fortressStr !== 18) throw new Error("STD-086 destruction-gated damage mismatch");

  await freshSandbox(["STD-124", "STD-020", "STD-008"]);
  const signoraFixture = await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player;
    const source = player.hand.find((card) => card.id === "STD-124");
    const enemyOb = player.hand.find((card) => card.id === "STD-020"); const enemyCode = player.hand.find((card) => card.id === "STD-008");
    if (enemyOb.category !== "Ob" || enemyCode.category !== "Code") throw new Error("STD-124 fixture categories are invalid");
    player.hand = [source]; player.front = []; player.back = [];
    player.trash = Array.from({ length: 5 }, (_, index) => ({ ...structuredClone(source), uid: `e2e-signora-trash-${index}` }));
    state.players.ai.front = [{ ...enemyOb, owner: "ai" }]; state.players.ai.back = [{ ...enemyCode, owner: "ai" }];
    player.deck = [{ ...structuredClone(enemyOb), uid: "e2e-signora-draw-1" }, { ...structuredClone(enemyCode), uid: "e2e-signora-draw-2" }];
    player.registry = [{ ...structuredClone(source), uid: "e2e-purple-symbol", id: "E2E-PURPLE", category: "Code", mounted: [], faceDown: false }];
    player.memory = 99; state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state); return { source: source.uid, enemyOb: enemyOb.uid, enemyCode: enemyCode.uid };
  });
  await page.locator(`.hand [data-card-uid="${signoraFixture.source}"]`).click();
  await page.locator('[data-action="play-front"]').first().click();
  const signora = await page.evaluate((uid) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState(); const card = state.players.player.front.find((item) => item.uid === uid);
    return { card, hand: state.players.player.hand.length, obSleep: state.players.ai.front[0]?.sleep, codeSleep: state.players.ai.back[0]?.sleep, winner: state.winner };
  }, signoraFixture.source);
  if (signora.card?.permanentAtk !== 5 || signora.card?.permanentStr !== 5 || signora.hand !== 2 || !signora.obSleep || signora.codeSleep || signora.winner) throw new Error("STD-124 X=5 cumulative Login mismatch");

  await freshSandbox(["STD-048", "STD-020"]);
  await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player; const ai = state.players.ai;
    const dawn = player.hand.find((card) => card.id === "STD-048"); const ruleDraw = player.hand.find((card) => card.id === "STD-020");
    player.hand = []; player.front = []; player.back = []; player.registry = [];
    player.deck = [{ ...structuredClone(ruleDraw), uid: "e2e-rule-draw", owner: "player" }, { ...structuredClone(dawn), uid: "e2e-dawn", owner: "player" }];
    ai.hand = []; ai.front = []; ai.back = []; ai.registry = []; ai.deck = [];
    player.turnsTaken = 0; player.user.frontLimit = 1; player.user.backLimit = 0; state.firstPlayer = "ai";
    state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state);
  });
  await page.locator('[data-action="end-turn"]').click();
  const dawnStart = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
  if (dawnStart.pending?.type !== "std048-draw-place" || !dawnStart.players.player.hand.some((card) => card.uid === "e2e-rule-draw")) throw new Error("STD-048 mandatory draw ordering mismatch");

  await freshSandbox(["STD-086", "STD-159", "STD-131"]);
  const corpseFixture = await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player; const ai = state.players.ai;
    const take = (id) => player.hand.find((card) => card.id === id);
    const shot = take("STD-086"); const corpse = take("STD-159"); const victim = take("STD-131"); victim.permanentStr = 20;
    player.hand = [shot]; player.front = [corpse]; player.back = []; ai.front = [victim]; ai.back = [];
    player.registry = [{ ...structuredClone(shot), uid: "e2e-red-symbol-159", id: "E2E-RED-159", category: "Code", mounted: [], faceDown: false }];
    player.memory = 99; state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state); return { shot: shot.uid, corpse: corpse.uid, victim: victim.uid };
  });
  await page.locator(`.hand [data-card-uid="${corpseFixture.shot}"]`).click();
  await page.locator('[data-action="play-front"]').first().click();
  await page.locator(`[data-card-uid="${corpseFixture.victim}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  await page.locator(`[data-card-uid="${corpseFixture.corpse}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const corpseResult = await page.evaluate((uid) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return { remains: state.players.player.front.some((card) => card.uid === uid), fortress: state.players.ai.fortressStr };
  }, corpseFixture.corpse);
  if (!corpseResult.remains || corpseResult.fortress !== 20) throw new Error("STD-159 face-up destruction immunity mismatch");
  const faceDownShot = await page.evaluate((uid) => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player;
    const corpse = player.front.find((card) => card.uid === uid); corpse.faceDown = true;
    const shot = { ...structuredClone(player.trash.find((card) => card.id === "STD-086")), uid: "e2e-shot-facedown" };
    player.hand = [shot]; state.pending = null; state.prompt = null; state.selectedUid = null; hook.setState(state); return shot.uid;
  }, corpseFixture.corpse);
  await page.locator(`.hand [data-card-uid="${faceDownShot}"]`).click();
  await page.locator('[data-action="play-front"]').first().click();
  await page.locator(`[data-card-uid="${corpseFixture.victim}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  await page.locator(`[data-card-uid="${corpseFixture.corpse}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const faceDownResult = await page.evaluate((uid) => window.__SIMPLE_ZEKE_E2E__.getState().players.player.trash.some((card) => card.uid === uid), corpseFixture.corpse);
  if (!faceDownResult) throw new Error("STD-159 face-down destruction path mismatch");

  await freshSandbox(["STD-086", "STD-159", "STD-131", "STD-020"]);
  const corpseTriggerFixture = await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player; const ai = state.players.ai;
    const take = (id) => player.hand.find((card) => card.id === id);
    const shot = take("STD-086"); const corpse = take("STD-159"); const victim = take("STD-131"); const sacrifice = take("STD-020");
    victim.permanentStr = 20; corpse.tempAtk = 0;
    player.hand = [shot]; player.front = [sacrifice]; player.back = [corpse]; ai.front = [victim]; ai.back = [];
    player.registry = [{ ...structuredClone(shot), uid: "e2e-red-symbol-159-trigger", id: "E2E-RED-159-TRIGGER", category: "Code", mounted: [], faceDown: false }];
    player.memory = 99; state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state); return { shot: shot.uid, corpse: corpse.uid, victim: victim.uid, sacrifice: sacrifice.uid };
  });
  await page.locator(`.hand [data-card-uid="${corpseTriggerFixture.shot}"]`).click();
  await page.locator('[data-action="play-front"]').first().click();
  await page.locator(`[data-card-uid="${corpseTriggerFixture.victim}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  await page.locator(`[data-card-uid="${corpseTriggerFixture.sacrifice}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const faceUpTriggerAtk = await page.evaluate((uid) => window.__SIMPLE_ZEKE_E2E__.getState().players.player.back.find((card) => card.uid === uid)?.tempAtk, corpseTriggerFixture.corpse);
  if (faceUpTriggerAtk !== 1) throw new Error("STD-159 face-up Ob-destruction trigger did not grant +1/0");

  const faceDownTriggerFixture = await page.evaluate(({ corpseUid, victimUid, sacrificeUid }) => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player; const ai = state.players.ai;
    const corpse = player.back.find((card) => card.uid === corpseUid); corpse.faceDown = true; corpse.tempAtk = 0;
    const priorShot = player.trash.find((card) => card.id === "STD-086"); const priorSacrifice = player.trash.find((card) => card.uid === sacrificeUid);
    const shot = { ...structuredClone(priorShot), uid: "e2e-shot-159-facedown-trigger" };
    const sacrifice = { ...structuredClone(priorSacrifice), uid: "e2e-ob-159-facedown-trigger", damage: 0, sleep: false };
    const victim = ai.front.find((card) => card.uid === victimUid); victim.damage = 0;
    player.hand = [shot]; player.front = [sacrifice]; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state); return { shot: shot.uid, sacrifice: sacrifice.uid };
  }, { corpseUid: corpseTriggerFixture.corpse, victimUid: corpseTriggerFixture.victim, sacrificeUid: corpseTriggerFixture.sacrifice });
  await page.locator(`.hand [data-card-uid="${faceDownTriggerFixture.shot}"]`).click();
  await page.locator('[data-action="play-front"]').first().click();
  await page.locator(`[data-card-uid="${corpseTriggerFixture.victim}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  await page.locator(`[data-card-uid="${faceDownTriggerFixture.sacrifice}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const faceDownTriggerAtk = await page.evaluate((uid) => window.__SIMPLE_ZEKE_E2E__.getState().players.player.back.find((card) => card.uid === uid)?.tempAtk, corpseTriggerFixture.corpse);
  if (faceDownTriggerAtk !== 0) throw new Error("STD-159 face-down copy incorrectly triggered from Ob destruction");

  await freshSandbox(["STD-142", "STD-139", "STD-140"]);
  const sacredFixture = await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player; const ai = state.players.ai;
    const take = (id) => player.hand.find((card) => card.id === id);
    const source = take("STD-142"); const own = take("STD-139"); const enemy = take("STD-140"); enemy.protect = 1;
    const hidden = { ...structuredClone(own), uid: "e2e-hidden-sacred", owner: "ai", faceDown: true };
    player.hand = []; player.front = []; player.back = [source, own]; ai.front = []; ai.back = [enemy, hidden];
    player.deck = []; ai.deck = []; state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state); return { source: source.uid, own: own.uid, enemy: enemy.uid, hidden: hidden.uid };
  });
  await page.locator('[data-action="end-turn"]').click();
  const turnEnd = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().pending);
  if (turnEnd?.request?.continuation?.type !== "std142-turn-end-choice") throw new Error("STD-142 turn-end choice missing");
  await page.locator(`[data-card-uid="${sacredFixture.source}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const sacredTargets = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().pending?.validTargets ?? []);
  if (!sacredTargets.includes(sacredFixture.own) || !sacredTargets.includes(sacredFixture.enemy) || sacredTargets.includes(sacredFixture.hidden)) throw new Error("STD-142 public target projection mismatch");
  await page.locator(`[data-card-uid="${sacredFixture.own}"]`).click();
  await page.locator(`[data-card-uid="${sacredFixture.enemy}"]`).click();
  await page.locator('[data-action="confirm-selection"]').click();
  const sacredOutcome = await page.evaluate((enemyUid) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return { continuation: state.pending?.request?.continuation?.type, maximum: state.pending?.request?.maximum, enemyRemains: state.players.ai.back.some((card) => card.uid === enemyUid) };
  }, sacredFixture.enemy);
  if (sacredOutcome.continuation !== "std142-salvage" || sacredOutcome.maximum !== 1 || !sacredOutcome.enemyRemains) throw new Error("STD-142 determined destruction count mismatch");

  await freshSandbox(["STD-036", "STD-018", "STD-020", "STD-021"]);
  const ifFixture = await page.evaluate(() => {
    const hook = window.__SIMPLE_ZEKE_E2E__; const state = hook.getState(); const player = state.players.player;
    const take = (id) => player.hand.find((card) => card.id === id);
    const normal = take("STD-036"); const eventOnly = take("STD-018"); const drawA = take("STD-020"); const drawB = take("STD-021");
    normal.faceDown = true; eventOnly.faceDown = true;
    player.back = [normal, eventOnly]; player.hand = []; player.deck = [drawA, drawB];
    player.memory = 20; state.active = "player"; state.pending = null; state.prompt = null; state.selectedUid = null; state.winner = null;
    hook.setState(state); return { normal: normal.uid, eventOnly: eventOnly.uid };
  });
  await page.locator(`[data-card-uid="${ifFixture.eventOnly}"]`).click();
  if (await page.locator('[data-action="activate-script"]').count()) throw new Error("STD-018 exposed invalid normal activation");
  await page.locator(`[data-card-uid="${ifFixture.normal}"]`).click();
  await page.locator('[data-action="activate-script"]').click();
  const ifOutcome = await page.evaluate((uid) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return { hand: state.players.player.hand.length, trashed: state.players.player.trash.some((card) => card.uid === uid), declared: state.declaredEffects.length };
  }, ifFixture.normal);
  if (ifOutcome.hand !== 2 || !ifOutcome.trashed || ifOutcome.declared !== 0) throw new Error("STD-036 normal declared resolution mismatch");

  if (errors.length) throw new Error(`browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ status: "passed", cards: ["STD-048", "STD-086", "STD-124", "STD-142", "STD-159"] }));
} finally {
  await browser.close();
}
