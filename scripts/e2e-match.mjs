import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const evidenceFlag = args.indexOf("--evidence-dir");
const url = args.find((value, index) => !value.startsWith("--") && index !== playwrightFlag + 1 && index !== evidenceFlag + 1) ?? "http://127.0.0.1:4176/";
const playwrightPath = playwrightFlag >= 0 ? path.resolve(args[playwrightFlag + 1] ?? "") : null;
const evidenceRoot = evidenceFlag >= 0 ? path.resolve(args[evidenceFlag + 1] ?? "") : null;
if (!playwrightPath || !existsSync(playwrightPath)) throw new Error("provide an existing --playwright-module PATH");
if (!evidenceRoot) throw new Error("provide --evidence-dir PATH");

const require = createRequire(import.meta.url);
const playwright = require(playwrightPath);
const { chromium } = playwright.default ?? playwright;
const profiles = [
  { id: "pc", route: "pc/", viewport: { width: 1600, height: 1000 } },
  { id: "mobile", route: "mobile/", viewport: { width: 844, height: 390 } }
];
const MAX_ACTIONS = 1000;
const MAX_TURNS = 120;
const AI_STALL_MS = 60000;
const trace = [];

const now = () => new Date().toISOString();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const compactError = (error) => ({ name: error?.name ?? "Error", message: String(error?.message ?? error).slice(0, 1200), stack: String(error?.stack ?? "").split("\n").slice(0, 8) });
const selectorValue = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function readState(page) {
  return page.evaluate(() => {
    const state = window.__SIMPLE_ZEKE_E2E__?.getState?.();
    if (!state) throw new Error("read-only E2E getState hook is unavailable");
    return JSON.parse(JSON.stringify(state, (_key, value) => typeof value === "function" ? undefined : value));
  });
}

function semantic(state) {
  const player = (entry) => ({
    str: entry.fortressStr, memory: entry.memory,
    hand: entry.hand?.map((card) => card.uid), front: entry.front?.map((card) => `${card.uid}:${card.sleep}`),
    back: entry.back?.map((card) => `${card.uid}:${card.sleep}:${card.faceDown}`), registry: entry.registry?.map((card) => card.uid),
    deck: entry.deck?.length, trash: entry.trash?.map((card) => card.uid), ban: entry.ban?.length
  });
  return JSON.stringify({ turn: state.turnNumber, active: state.active, phase: state.phase, pending: state.pending?.type ?? null,
    prompt: state.prompt?.type ?? null, thread: state.triggerThread?.items?.length ?? 0, victory: state.victory,
    declared: state.declaredEffects?.length ?? 0, player: player(state.players.player), ai: player(state.players.ai), events: state.events?.length ?? 0 });
}

function boundedState(state) {
  const player = (entry) => ({ user: entry.user?.id, fortressStr: entry.fortressStr, memory: entry.memory,
    hand: entry.hand?.map((card) => ({ uid: card.uid, id: card.id, category: card.category, cost: card.cost })),
    front: entry.front?.map((card) => ({ uid: card.uid, id: card.id, sleep: card.sleep })),
    back: entry.back?.map((card) => ({ uid: card.uid, id: card.id, faceDown: card.faceDown })),
    registry: entry.registry?.map((card) => ({ uid: card.uid, id: card.id })), deckCount: entry.deck?.length,
    trashCount: entry.trash?.length, banCount: entry.ban?.length });
  return { mode: state.mode, turnNumber: state.turnNumber, active: state.active, phase: state.phase,
    pending: state.pending ? { type: state.pending.type, validTargets: state.pending.validTargets?.slice(0, 20),
      continuation: state.pending.request?.continuation?.type ?? state.pending.continuation?.type ?? null } : null,
    prompt: state.prompt ? { type: state.prompt.type, playerId: state.prompt.playerId } : null,
    triggerItems: state.triggerThread?.items?.length ?? 0, resolvingDeclaredEffect: state.resolvingDeclaredEffect ?? null,
    declaredEffects: state.declaredEffects?.length ?? 0, winner: state.winner ?? null, victory: state.victory ?? null,
    players: { player: player(state.players.player), ai: player(state.players.ai) } };
}

async function firstVisible(page, selector, { enabled = true } = {}) {
  const nodes = page.locator(selector);
  for (let index = 0; index < await nodes.count(); index += 1) {
    const node = nodes.nth(index);
    if (await node.isVisible() && (!enabled || await node.isEnabled())) return node;
  }
  return null;
}

async function clickVisible(page, selector) {
  const node = await firstVisible(page, selector);
  if (!node) return false;
  await node.click();
  return true;
}

async function availableActions(page) {
  return page.locator("button[data-action], button[data-live], button[data-live-slot], button[data-selection-option], button[data-trigger-item], button[data-response-card], button[data-plugin-number]").evaluateAll((nodes) => nodes
    .filter((node) => node.offsetWidth || node.offsetHeight || node.getClientRects().length)
    .slice(0, 80).map((node) => ({ text: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 120), disabled: Boolean(node.disabled),
      action: node.dataset.action ?? null, live: node.dataset.live ?? null, slot: node.dataset.liveSlot ?? null,
      selection: node.dataset.selectionOption ?? null, trigger: node.dataset.triggerItem ?? null,
      pluginNumber: node.dataset.pluginNumber ?? null })));
}

function record(profile, kind, state, detail = {}) {
  trace.push({ at: now(), profile, kind, turnNumber: state.turnNumber, active: state.active,
    pending: state.pending?.type ?? null, prompt: state.prompt?.type ?? null, ...detail });
}

async function clickCard(page, uid) {
  return clickVisible(page, `[data-card-uid="${selectorValue(uid)}"]`);
}

async function openHand(page) {
  if (await firstVisible(page, '.r2-hand [data-card-uid]')) return;
  if (!await clickVisible(page, '[data-live="hand"]')) throw new Error("hand is not visible and has no enabled toggle");
}

async function settle(page, profile, counters) {
  for (let step = 0; step < 80; step += 1) {
    const state = await readState(page);
    if (state.victory?.finished) return true;
    if (await clickVisible(page, "[data-trigger-item]")) { counters.driverActions += 1; record(profile, "trigger", state); continue; }
    if (await clickVisible(page, '[data-action="response-decline"]')) { counters.driverActions += 1; record(profile, "response-decline", state); continue; }
    const pluginNumber = await firstVisible(page, "[data-plugin-number]");
    if (pluginNumber) {
      const chosenNumber = Number(await pluginNumber.getAttribute("data-plugin-number"));
      const promptBefore = JSON.stringify(state.prompt ?? null);
      await pluginNumber.click();
      const after = await readState(page);
      const promptAfter = JSON.stringify(after.prompt ?? null);
      if (promptAfter === promptBefore) throw new Error(`plugin-number ${chosenNumber} did not advance the prompt`);
      counters.driverActions += 1;
      record(profile, "plugin-number", after, { chosenNumber, promptBefore: state.prompt?.type ?? null, promptAfter: after.prompt?.type ?? null });
      continue;
    }
    if (await clickVisible(page, '[data-action="prompt-decline"]')) { counters.driverActions += 1; record(profile, "prompt-decline", state); continue; }
    if (state.pending?.type === "selection") {
      const confirm = await firstVisible(page, '[data-action="confirm-selection"]');
      if (confirm && await confirm.isEnabled()) { await confirm.click(); counters.driverActions += 1; record(profile, "selection-confirm", state, { selected: 0 }); continue; }
      const scope = await firstVisible(page, "[data-selection-scope]");
      if (scope) {
        const values = await scope.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
        if (!values.length) throw new Error("selection scope has no selectable option");
        await scope.selectOption(values[0]); counters.driverActions += 1; record(profile, "selection-scope", state, { value: values[0] }); continue;
      }
      const allocations = page.locator("[data-selection-allocation]");
      if (await allocations.count()) {
        const total = Number(state.pending.request?.spec?.total ?? 0); let remaining = total;
        for (let index = 0; index < await allocations.count(); index += 1) {
          const input = allocations.nth(index); const maximum = Number(await input.getAttribute("max") ?? remaining);
          const value = Math.max(0, Math.min(remaining, Number.isFinite(maximum) ? maximum : remaining));
          await input.fill(String(value)); await input.dispatchEvent("change"); remaining -= value;
        }
        if (remaining !== 0) throw new Error(`selection allocation cannot satisfy total ${total}`);
        counters.driverActions += 1; record(profile, "selection-allocation", state, { total }); continue;
      }
      const selected = new Set(state.pending.request?.selected ?? []);
      const candidate = (state.pending.request?.candidates ?? []).find((value) => !selected.has(value));
      const option = candidate === undefined ? null
        : await firstVisible(page, `[data-selection-option="${selectorValue(candidate)}"], [data-card-uid="${selectorValue(candidate)}"]`);
      if (!option) throw new Error(`selection has no unselected visible option: ${state.pending.request?.continuation?.type ?? "unknown"}`);
      await option.click(); counters.driverActions += 1; record(profile, "selection-option", state, { candidate }); continue;
    }
    if (await clickVisible(page, "[data-effect-id]")) { counters.driverActions += 1; record(profile, "effect-choice", state); continue; }
    if (await clickVisible(page, "[data-live-slot]")) { counters.driverActions += 1; record(profile, "placement", state); continue; }
    if (state.pending) {
      const alreadySelected = new Set(state.pending.selectedTargets ?? []);
      const targets = (state.pending.validTargets ?? []).filter((target) => !alreadySelected.has(target));
      let chosen = false;
      for (const target of targets) {
        const selector = String(target).endsWith("-fortress")
          ? `[data-fortress="${String(target).replace(/-fortress$/, "")}"]`
          : `[data-card-uid="${selectorValue(target)}"]`;
        if (await clickVisible(page, selector)) { chosen = true; break; }
      }
      if (chosen) { counters.driverActions += 1; record(profile, "pending-target", state, { type: state.pending.type }); continue; }
      for (const action of ["confirm-effect-targets", "confirm-layered", "effect-move-front", "effect-move-back", "place-junk-front", "place-junk-back", "access-drag-front", "access-drag-back", "lucky-no"]) {
        if (await clickVisible(page, `[data-action="${action}"]`)) { chosen = true; counters.driverActions += 1; record(profile, action, state); break; }
      }
      if (chosen) continue;
      throw new Error(`unknown pending interaction: ${state.pending.type}`);
    }
    if (state.prompt) throw new Error(`unknown prompt interaction: ${state.prompt.type}`);
    if (state.triggerThread?.items?.length) throw new Error("trigger thread has no visible choice");
    return false;
  }
  throw new Error("interaction settling exceeded 80 actions");
}

async function attemptAttack(page, state, profile, counters, attempted) {
  const cards = [...state.players.player.front].filter((card) => !attempted.has(card.uid))
    .sort((left, right) => Number(right.atk ?? 0) - Number(left.atk ?? 0));
  for (const card of cards) {
    attempted.add(card.uid);
    if (!await clickCard(page, card.uid)) continue;
    if (!await clickVisible(page, '[data-action="prepare-attack"]')) continue;
    counters.driverActions += 1;
    const before = semantic(state);
    await settle(page, profile, counters);
    const after = await readState(page);
    if (semantic(after) === before) { record(profile, "attack-rejected", after, { uid: card.uid, id: card.id }); continue; }
    counters.attack += 1; record(profile, "attack", after, { uid: card.uid, id: card.id }); return true;
  }
  return false;
}

async function attemptInstall(page, state, profile, counters, attempted) {
  const cards = [...state.players.player.hand].filter((card) => !attempted.has(card.uid))
    .sort((left, right) => Number(left.cost ?? 0) - Number(right.cost ?? 0));
  for (const card of cards) {
    attempted.add(card.uid);
    await openHand(page);
    if (!await clickCard(page, card.uid)) continue;
    if (!await clickVisible(page, '[data-action="install"]')) continue;
    counters.driverActions += 1;
    await settle(page, profile, counters);
    const after = await readState(page);
    const installed = after.players.player.registry.some((item) => item.uid === card.uid) && !after.players.player.hand.some((item) => item.uid === card.uid);
    if (!installed) { record(profile, "install-rejected", after, { uid: card.uid, id: card.id }); continue; }
    counters.install += 1; record(profile, "install", after, { uid: card.uid, id: card.id }); return true;
  }
  return false;
}

async function attemptPlay(page, state, profile, counters, attempted) {
  const cards = [...state.players.player.hand].filter((card) => !attempted.has(card.uid))
    .sort((left, right) => (Number(right.cost ?? 0) + Number(right.atk ?? 0) + Number(right.str ?? 0)) - (Number(left.cost ?? 0) + Number(left.atk ?? 0) + Number(left.str ?? 0)));
  for (const card of cards) {
    attempted.add(card.uid);
    await openHand(page);
    if (!await clickCard(page, card.uid)) continue;
    let action = null;
    for (const selector of ['[data-live="execute"]', '[data-action="play-front"]', '[data-action="set-script"]']) {
      if (await clickVisible(page, selector)) { action = selector; break; }
    }
    if (!action) continue;
    counters.driverActions += 1;
    await settle(page, profile, counters);
    const after = await readState(page);
    const moved = !after.players.player.hand.some((item) => item.uid === card.uid);
    if (!moved) { record(profile, "play-rejected", after, { uid: card.uid, id: card.id, action }); continue; }
    counters.play += 1; record(profile, "play", after, { uid: card.uid, id: card.id, action }); return true;
  }
  return false;
}

async function waitForAi(page, profile, counters) {
  let lastProgress = Date.now(); let previous = semantic(await readState(page));
  for (;;) {
    await settle(page, profile, counters);
    const state = await readState(page);
    const current = semantic(state);
    if (current !== previous) { previous = current; lastProgress = Date.now(); counters.opponentProgress = true; record(profile, "ai-progress", state); }
    if (state.victory?.finished || state.active !== "ai") return state;
    if (Date.now() - lastProgress > AI_STALL_MS) throw new Error("AI state remained unchanged beyond the 60 second progress boundary");
    await wait(250);
  }
}

async function failureEvidence(page, profile, error) {
  let state = null; let actions = [];
  try { state = boundedState(await readState(page)); } catch {}
  try { actions = await availableActions(page); } catch {}
  const screenshot = path.join(evidenceRoot, `${profile.id}-failure.png`);
  try { await page.screenshot({ path: screenshot, fullPage: true }); } catch {}
  const failure = { profile: profile.id, at: now(), error: compactError(error), state, actions, screenshot };
  await writeFile(path.join(evidenceRoot, `${profile.id}-failure.json`), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  return failure;
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({ viewport: profile.viewport });
  await context.addInitScript(({ seed }) => {
    let value = seed >>> 0;
    Math.random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x100000000; };
  }, { seed: 0x5a17 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => { if (pageErrors.length < 20) pageErrors.push(compactError(error)); });
  const counters = { driverActions: 0, play: 0, install: 0, attack: 0, opponentProgress: false };
  try {
    const target = new URL(profile.route, url); target.searchParams.set("e2e", "1");
    await page.goto(target.toString(), { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.setItem("sz-ui-effects", "on"));
    await page.reload({ waitUntil: "networkidle" });
    await clickEntryControl(page, '[data-mode="ai"]');
    await page.locator(".r2-board").waitFor({ state: "visible" });
    const initial = await readState(page);
    const initialRecord = { playerDeckId: initial.playerDeckId, aiDeckId: initial.aiDeckId,
      playerUserId: initial.playerUserId, aiUserId: initial.aiUserId,
      playerUserCardId: initial.players.player.user?.id, aiUserCardId: initial.players.ai.user?.id,
      counts: Object.fromEntries(Object.entries(initial.players).map(([id, entry]) => [id, { hand: entry.hand.length, deck: entry.deck.length, front: entry.front.length, back: entry.back.length, registry: entry.registry.length }])) };
    if (initial.mode !== "ai" || initial.turnNumber !== 1 || initial.players.player.front.length || initial.players.player.back.length || initial.players.ai.front.length || initial.players.ai.back.length) throw new Error("AI match did not start from an ordinary empty first-turn board");
    if (initial.playerDeckId !== "red" || initial.aiDeckId !== "yellow" || initial.playerUserId !== "doors_zx") throw new Error(`title defaults drifted: ${JSON.stringify(initialRecord)}`);
    if (initial.players.player.memory <= 0 || initial.players.ai.memory <= 0 || initial.players.player.hand.length <= 0 || initial.players.ai.hand.length <= 0) throw new Error("AI match did not start with ordinary resources and hands");
    record(profile.id, "match-start", initial, initialRecord);
    let currentTurn = initial.turnNumber;
    let attempts = { attack: new Set(), install: new Set(), play: new Set() };
    while (true) {
      if (counters.driverActions >= MAX_ACTIONS) throw new Error(`driver action limit reached: ${MAX_ACTIONS}`);
      let state = await readState(page);
      if (state.victory?.finished) break;
      if (state.turnNumber > MAX_TURNS) throw new Error(`turn limit reached: ${MAX_TURNS}`);
      if (state.turnNumber !== currentTurn) { currentTurn = state.turnNumber; attempts = { attack: new Set(), install: new Set(), play: new Set() }; record(profile.id, "turn", state); }
      if (state.active === "ai") { await waitForAi(page, profile.id, counters); continue; }
      if (state.active !== "player") throw new Error(`unknown active player: ${state.active}`);
      if (await settle(page, profile.id, counters)) break;
      state = await readState(page);
      if (state.victory?.finished) break;
      if (await attemptAttack(page, state, profile.id, counters, attempts.attack)) continue;
      if (counters.install === 0 && await attemptInstall(page, state, profile.id, counters, attempts.install)) continue;
      if (await attemptPlay(page, state, profile.id, counters, attempts.play)) continue;
      if (await attemptInstall(page, state, profile.id, counters, attempts.install)) continue;
      if (!await clickVisible(page, '[data-action="end-turn"]')) throw new Error("player turn has no feasible action and no enabled end-turn control");
      counters.driverActions += 1; record(profile.id, "end-turn", state);
    }
    const final = await readState(page);
    const outcome = final.victory?.lockedOutcome;
    if (final.victory?.finished !== true || !["player", "ai", "draw"].includes(outcome) || (final.winner ?? outcome) !== outcome) throw new Error("natural finish lacks a consistent locked result");
    if (final.pending || final.prompt || final.resolvingDeclaredEffect || (final.declaredEffects?.length ?? 0) !== 0) throw new Error("natural finish retained unresolved interaction or declared effects");
    if (!counters.play || !counters.install || !counters.attack || !counters.opponentProgress) throw new Error(`required observed actions are incomplete: ${JSON.stringify(counters)}`);
    if (pageErrors.length) throw new Error(`page errors observed: ${JSON.stringify(pageErrors)}`);
    const resultDialog = page.locator('.r2-result[aria-label="対戦結果"]');
    await resultDialog.waitFor({ state: "visible" });
    const displayedOutcome = await resultDialog.getAttribute("data-outcome");
    if (displayedOutcome !== outcome) throw new Error(`visible result ${displayedOutcome} differs from locked outcome ${outcome}`);
    const rematch = await firstVisible(page, '[data-live="rematch"]');
    const home = await firstVisible(page, '.r2-result [data-live="home"]');
    if (!rematch || !home || !await rematch.isEnabled() || !await home.isEnabled()) throw new Error("result does not expose enabled rematch and title controls");
    const screenshot = path.join(evidenceRoot, `${profile.id}-end.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await home.click();
    await page.locator(".r2-entry").waitFor({ state: "visible" });
    if (!await firstVisible(page, '[data-mode="ai"]')) throw new Error("title return did not restore the AI entry control");
    record(profile.id, "title-return", final, { outcome });
    return { id: profile.id, route: profile.route, viewport: profile.viewport, state: "passed", initial: initialRecord,
      final: { turnNumber: final.turnNumber, winner: final.winner ?? null, lockedOutcome: outcome, finished: true },
      actionCounts: counters, pageErrors, screenshot, observedCoverage: ["natural-title-start", "ordinary-first-turn", "player-install", "player-play", "player-attack", "opponent-turn-progress", "finished-result", "title-return"],
      unencounteredCoverage: ["all-card-effects", "all-selection-kinds", "all-end-effect-boundaries"] };
  } catch (error) {
    const failure = await failureEvidence(page, profile, error);
    throw Object.assign(error, { matchFailure: failure });
  } finally {
    await context.close();
  }
}

await mkdir(evidenceRoot, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const profile of profiles) results.push(await runProfile(browser, profile));
  const exact = results.map((result) => result.id);
  if (JSON.stringify(exact) !== JSON.stringify(["pc", "mobile"]) || results.some((result) => result.state !== "passed")) throw new Error("profile result set is not exact pc/mobile PASS");
  if (!results.some((result) => result.final.turnNumber > 10)) throw new Error("neither natural match progressed beyond turn 10");
  const result = { schema_version: 1, url, seed: "0x5a17", results, exactProfiles: ["pc", "mobile"], ok: true };
  await writeFile(path.join(evidenceRoot, "match-trace.json"), `${JSON.stringify({ schema_version: 1, trace }, null, 2)}\n`, "utf8");
  await writeFile(path.join(evidenceRoot, "match-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ evidenceRoot, results: results.map(({ id, state, final, actionCounts }) => ({ id, state, final, actionCounts })), ok: true }));
} catch (error) {
  const result = { schema_version: 1, url, seed: "0x5a17", results, failure: error.matchFailure ?? { error: compactError(error) }, ok: false };
  await writeFile(path.join(evidenceRoot, "match-trace.json"), `${JSON.stringify({ schema_version: 1, trace }, null, 2)}\n`, "utf8");
  await writeFile(path.join(evidenceRoot, "match-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ evidenceRoot, failure: result.failure, ok: false }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
