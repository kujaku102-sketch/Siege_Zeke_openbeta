import test from "node:test";
import assert from "node:assert/strict";
import { createGame, addSandboxCardToHand, playCard, findCard, restSecurity, playLayeredCard, relogCard, canPlayLayeredCard, resolveCardSelection } from "../src/game/engine.js";
import { runSimpleAiTurnSteps } from "../src/game/ai.js";
import { createCardInstance } from "../src/data/cards.js";
import { createTutorialFlow, completeTutorialIntroduction } from "../src/data/tutorial.js";
import { leaveTutorial, requestTurnEnd, executionSlots, livePlacementSlots, avoidFocus, shouldAutoStartAiTurn, stepBackInput, dismissBoardSelection, mobileConsoleScale, isDownwardHandSwipe } from "../src/ui-refresh/session.js";
import { liveHtml, liveInteractionHtml } from "../src/ui-refresh/live-view.js";
import { createInteractionPatcher, selectionFlags, updateSelectionMarkers } from "../src/ui-refresh/selection-render.js";
import { adminDrawerHtml, triggerThreadHtml } from "../src/ui/render.js";
import { createSelectionRequest } from "../src/game/selection-model.js";
import { guideSize } from "../src/ui-refresh/guide.js";
import { createWorkCache, createFrameScheduler } from "../src/ui-refresh/work-cache.js";

const clean = () => {
  const state = createGame({ mode: "sandbox", sandboxDeckSetup: true, rng: () => .5 });
  state.sandboxUi.alternateTurns = true;
  state.mode = "lab";
  for (const p of Object.values(state.players)) { p.front = []; p.back = []; p.hand = []; p.registry = []; p.memory = 30; }
  return state;
};
const add = (state, id, owner = "player") => { addSandboxCardToHand(state, owner, id); return state.players[owner].hand.at(-1); };
const ui = { view: "pc", screen: "game", handOpen: true, tapDetails: true, detailUid: null, draft: null };

test("back command unwinds one uncommitted input layer without touching game history", () => {
  const state = clean(), card = add(state, "STD-020");
  const input = { ...ui, detailUid: card.uid, draft: { type: "placement", sourceUid: card.uid } };
  state.selectedUid = card.uid;
  const historyLength = state.history.length;
  assert.match(liveHtml(state, null, input), /data-live="cancel"[^>]*>戻る<\/button>/);
  assert.equal(stepBackInput(state, input), true);
  assert.equal(input.draft, null);
  assert.equal(input.detailUid, card.uid);
  assert.equal(stepBackInput(state, input), true);
  assert.equal(input.detailUid, null);
  assert.equal(state.selectedUid, card.uid);
  assert.equal(stepBackInput(state, input), true);
  assert.equal(state.selectedUid, null);
  assert.equal(stepBackInput(state, input), false);
  assert.equal(state.history.length, historyLength);
});

test("blank board dismisses all uncommitted selection layers but never an engine choice", () => {
  const state = clean(), card = add(state, "STD-020");
  const input = { ...ui, detailUid: card.uid, draft: { type: "placement", sourceUid: card.uid } };
  state.selectedUid = card.uid;
  const historyLength = state.history.length;
  assert.equal(dismissBoardSelection(state, input), true);
  assert.equal(state.selectedUid, null);
  assert.equal(input.detailUid, null);
  assert.equal(input.draft, null);
  assert.equal(state.history.length, historyLength);
  state.selectedUid = card.uid;
  state.pending = { type: "selection" };
  assert.equal(dismissBoardSelection(state, input), false);
  assert.equal(state.selectedUid, card.uid);
});

test("mobile console preserves its 660px design ratio and downward hand swipe ignores horizontal scroll", () => {
  assert.equal(mobileConsoleScale(800), 1);
  assert.equal(mobileConsoleScale(398), .5);
  assert.equal(mobileConsoleScale(418, 10, 10), .5);
  assert.equal(isDownwardHandSwipe({ x: 20, y: 20 }, { x: 35, y: 90 }), true);
  assert.equal(isDownwardHandSwipe({ x: 20, y: 20 }, { x: 100, y: 90 }), false);
  assert.equal(isDownwardHandSwipe({ x: 20, y: 20 }, { x: 20, y: 90 }, "mouse"), false);
});

test("AI turn starts after a player's turn-end access choice completes", () => {
  const state = createGame({ mode: "ai", rng: () => .5 });
  const player = state.players.player;
  player.hand = [];
  player.front = [createCardInstance("SZTB-094", "player", 995101)];
  player.back = [];
  player.deck = [createCardInstance("SZTB-099", "player", 995103)];
  assert.equal(requestTurnEnd(state), "waiting");
  assert.equal(state.turnNumber, 1);
  assert.equal(state.active, "player");
  const request = state.pending.request;
  assert.equal(resolveCardSelection(state, request.continuation, { selected: [request.candidates[0]] }), true);
  assert.equal(state.turnNumber, 2);
  assert.equal(state.active, "ai");
  assert.equal(shouldAutoStartAiTurn(state, { iterator: null, pacing: null, startedState: null, startedTurn: 0 }), true);
  assert.equal(shouldAutoStartAiTurn(state, { iterator: null, pacing: null, startedState: state, startedTurn: 2 }), false);
});

test("March exposes Alliance deck choices in both UIs and resolves with normal payment", () => {
  const state = clean(), player = state.players.player;
  const source = add(state, "STD-035"), first = add(state, "STD-020"), dualClass = add(state, "SZTB-092");
  const nonAlliance = add(state, "STD-048"), field = add(state, "SZTB-093");
  player.hand = [source]; player.deck = [first, nonAlliance, dualClass]; player.front = [field]; player.memory = 5;
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(player.memory, 0);
  assert.deepEqual(new Set(state.pending.request.candidates), new Set([first.uid, dualClass.uid]));
  for (const view of ["pc", "mobile"]) {
    const html = liveHtml(state, null, { ...ui, view });
    assert.ok(html.includes(`data-selection-option="${first.uid}"`));
    assert.ok(html.includes(`data-selection-option="${dualClass.uid}"`));
    assert.ok(!html.includes(`data-selection-option="${nonAlliance.uid}"`));
    assert.match(html, /対象確定 0\/2/);
  }
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid, dualClass.uid] }), true);
  assert.ok(player.hand.includes(first) && player.hand.includes(dualClass));
  assert.ok(player.trash.some(card => card.uid === source.uid));
  assert.equal(field.tempAtk, 1);
});

test("work cache is bounded, caches empty values, and explicitly invalidates mutable epochs", () => {
  const cache = createWorkCache(2);
  let calls = 0;
  const lookup = key => cache.reuse("detail", [key], () => { calls++; return undefined; });
  lookup("a"); lookup("b"); lookup("a"); lookup("c"); lookup("b");
  assert.equal(calls, 4); // b was the least recently used entry.
  cache.invalidate("detail"); lookup("b");
  cache.invalidate(); lookup("b");
  assert.deepEqual(cache.snapshot().detail, { runs: 6, hits: 1 });
  const snapshot = cache.snapshot(); snapshot.detail.runs = 0;
  assert.equal(cache.snapshot().detail.runs, 6);
});

test("detail projection reuses UI-only reads but refreshes status/layers at the next game epoch", () => {
  const state = clean(), card = add(state, "STD-075"), other = add(state, "STD-077");
  const cache = createWorkCache(16);
  const detail = uid => liveInteractionHtml(state, null, { ...ui, detailUid: uid }, cache).detail;
  const original = detail(card.uid);
  detail(other.uid); state.selectedUid = other.uid;
  assert.equal(detail(card.uid), original);
  assert.deepEqual(cache.snapshot()["detail-html"], { runs: 2, hits: 1 });
  card.sleep = true; card.mounted = [{ ...other, layerRole: "mount" }];
  cache.invalidate();
  const changed = detail(card.uid);
  assert.notEqual(changed, original);
  assert.match(changed, /スリープ/); assert.match(changed, /レイヤー 2/);
  // Even an existing cached face must be permission-checked before reuse.
  state.players.player.hand = []; state.players.ai.hand = [card];
  assert.equal(detail(card.uid), "");
});

test("entry generates no game projections while keeping menu, deck builder, and notices", () => {
  const state = clean();
  for (const player of Object.values(state.players)) {
    for (const zone of ["hand", "front", "back", "registry"]) Object.defineProperty(player, zone, { get() { throw Error(`unnecessary ${zone} projection`); } });
  }
  const html = liveHtml(state, null, { ...ui, screen: "entry", notice: "ready" });
  assert.match(html, /チュートリアル/); assert.match(html, /data-deck-open/);
  assert.match(html, /ready/); assert.doesNotMatch(html, /battle-board|r2-hand-scroll|r2-console/);
});

test("entry settings omit deck and noise controls and keep CRT and ordinary routes", () => {
  const state = clean();
  const base = { ...ui, screen: "entry", options: true, effectsEnabled: true };
  const crt = liveHtml(state, null, { ...base, entryCrtMenu: true });
  const ordinary = liveHtml(state, null, { ...base, effectsEnabled: false, entryCrtMenu: false });
  assert.match(crt, /r2-title-options-crt/);
  assert.match(crt, /data-live="fullscreen"/);
  assert.match(crt, /data-toggle-effects/);
  assert.match(crt, /data-volume="10"/);
  assert.doesNotMatch(crt, /data-player-deck|data-logo-profile|data-logo-video/);
  assert.match(ordinary, /class="r2-modal r2-title-options"/);
  assert.doesNotMatch(ordinary, /r2-title-options-crt/);
});

test("passive layout requests coalesce and a synchronous update cancels stale work", () => {
  const frames = new Map(); let id = 0, runs = 0;
  const scheduler = createFrameScheduler(() => runs++, fn => { frames.set(++id, fn); return id; }, key => frames.delete(key));
  for (let i = 0; i < 30; i++) scheduler.schedule();
  assert.equal(frames.size, 1);
  const frame = frames.values().next().value; frames.clear(); frame();
  assert.equal(runs, 1);
  scheduler.schedule(); scheduler.cancel();
  assert.equal(frames.size, 0); assert.equal(runs, 1);
  scheduler.schedule(); assert.equal(frames.size, 1);
});

test("selection projection excludes the board and hand, remains pure, and respects concealed details", () => {
  const state = clean(), card = add(state, "STD-075"), secret = add(state, "STD-022", "ai");
  state.selectedUid = card.uid;
  const before = JSON.stringify(state);
  const parts = liveInteractionHtml(state, null, { ...ui, detailUid: card.uid });
  assert.match(parts.detail, /ジャンキー/);
  assert.match(parts.popup, /data-live="execute"/);
  assert.doesNotMatch(Object.values(parts).join(""), /battle-board|r2-hand-scroll|r2-board-fit/);
  assert.equal(JSON.stringify(state), before);
  state.selectedUid = secret.uid;
  const concealed = liveInteractionHtml(state, null, { ...ui, detailUid: secret.uid });
  assert.equal(concealed.detail, "");
  assert.equal(concealed.popup, "");
});

test("selection region patcher retains unchanged details and binds only replaced regions", () => {
  const hosts = Object.fromEntries(["commands", "detail", "popup", "extras", "notice"].map(name => [name, { writes: 0, set innerHTML(html) { this.html = html; this.writes++; } }]));
  const root = { querySelector: selector => hosts[selector.match(/="([^"]+)"/)[1]] };
  const patcher = createInteractionPatcher();
  const parts = { commands: "cancel", detail: "art", popup: "actions", extras: "", notice: "" };
  assert.equal(patcher.patch(root, parts).length, 5);
  assert.equal(patcher.patch(root, parts).length, 0);
  assert.deepEqual(patcher.patch(root, { ...parts, popup: "" }), [hosts.popup]);
  assert.equal(hosts.detail.writes, 1);
  patcher.reset();
  assert.equal(patcher.patch(root, parts).length, 5);
});

test("selection markers clear old selection, target and material flags without replacing cards", () => {
  const node = dataset => ({ dataset, flags: {}, classList: { contains: () => false, toggle(name, on) { this.owner.flags[name] = on; } } });
  const card = node({ cardUid: "card-a" }), user = node({ fortress: "ai" });
  card.classList.owner = card; user.classList.owner = user;
  const root = { querySelectorAll: selector => selector === "[data-card-uid]" ? [card] : selector === "[data-fortress]" ? [user] : [] };
  const state = { selectedUid: "card-a", pending: { type: "selection", validTargets: ["card-a", "ai-fortress"], request: { selected: ["card-a"] } } };
  assert.deepEqual(updateSelectionMarkers(root, state), []);
  assert.deepEqual(card.flags, { selected: true, targetable: true, "material-selected": true });
  assert.equal(user.flags.targetable, true);
  state.selectedUid = null; state.pending = null;
  updateSelectionMarkers(root, state);
  assert.deepEqual(card.flags, { selected: false, targetable: false, "material-selected": false });
  assert.equal(user.flags.targetable, false);
  for (const type of ["layered-select", "effect-target-multi"]) {
    assert.equal(selectionFlags({ pending: { type, selectedTargets: ["x"] } }, "x")["material-selected"], true);
  }
});

test("ambiguous device asks for a view before exposing game actions", () => {
  const html = liveHtml(clean(), null, { ...ui, view: null });
  assert.ok(html.includes('data-view="pc"'));
  assert.ok(html.includes('data-view="mobile"'));
  assert.ok(!html.includes('data-layout='));
});

test("component detail never reveals the opponent's concealed card or deck", () => {
  const state = clean();
  const card = add(state, "STD-022", "ai");
  card.grantedKeywords = ["PRIVATE_COMPONENT"];
  const view = () => liveHtml(state, null, { ...ui, detailUid: card.uid });
  assert.doesNotMatch(view(), /PRIVATE_COMPONENT|component-list/);
  state.players.ai.hand = []; state.players.ai.back = [card]; card.faceDown = true;
  assert.doesNotMatch(view(), /PRIVATE_COMPONENT|component-list/);
  card.faceDown = false;
  assert.match(view(), /PRIVATE_COMPONENT/);
  state.players.ai.back = []; state.players.ai.deck = [card];
  assert.doesNotMatch(view(), /PRIVATE_COMPONENT|component-list/);
});

test("refreshed registry drawer conceals opponent face-down identity", () => {
  const state = clean();
  const card = add(state, "STD-022", "ai");
  state.players.ai.hand = []; card.faceDown = true; card.name = "PRIVATE_TEST_NAME";
  state.players.ai.registry = [card]; state.openAdmin = { playerId: "ai", zoneName: "registry" };
  const hidden = adminDrawerHtml({ ...state, viewerId: "player" });
  assert.ok(hidden.includes("裏向きカード"));
  assert.ok(!hidden.includes(card.name));
  assert.ok(adminDrawerHtml({ ...state, viewerId: "ai" }).includes(card.name));
});

test("tutorial exit retains board and permits two complete manual rounds", () => {
  const state = createGame({ mode: "tutorial", rng: () => .5 });
  const before = JSON.stringify(state.players);
  assert.equal(leaveTutorial(state), true);
  assert.equal(JSON.stringify(state.players), before);
  assert.equal(state.sandboxUi.opponentControl, "manual");
  for (let n = 0; n < 4; n++) {
    assert.equal(requestTurnEnd(state), "advanced");
    assert.equal(state.sandboxUi.actor, state.active);
    assert.equal(state.active, n % 2 === 0 ? "ai" : "player");
  }
  assert.equal(state.turnNumber, 5);
  assert.equal(state.active, "player");
});

test("tutorial exit and turn-end never erase an internal choice or prompt", () => {
  for (const field of ["pending", "prompt", "effectResolution"]) {
    const state = createGame({ mode: "tutorial" }); state[field] = { type: "required" };
    const before = JSON.stringify(state);
    assert.equal(leaveTutorial(state), false);
    assert.equal(requestTurnEnd(state), "blocked");
    assert.equal(JSON.stringify(state), before);
  }
});

test("security end window preserves the turn, accepts multiple optional sleeps or none", () => {
  for (const count of [0, 1, 2]) {
    const state = clean();
    const guards = [add(state, "STD-022"), add(state, "STD-022")];
    for (const card of guards) playCard(state, "player", card.uid);
    state.mode = "sandbox";
    assert.equal(restSecurity(state, "player", guards[0].uid), false);
    assert.equal(requestTurnEnd(state), "waiting");
    assert.equal(state.active, "player");
    assert.equal(state.turnNumber, 1);
    for (const card of guards.slice(0, count)) assert.equal(restSecurity(state, "player", card.uid), true);
    assert.equal(requestTurnEnd(state), "advanced");
    assert.equal(guards.filter(card => card.sleep).length, count);
    assert.equal(state.active, "ai");
  }
});

test("security is not offered during main and is explicit at turn end", () => {
  const state = clean(), card = add(state, "STD-022"); playCard(state, "player", card.uid);
  state.mode = "sandbox"; state.selectedUid = card.uid;
  const before = liveHtml(state, null, ui);
  assert.doesNotMatch(before, /data-action="security-rest"/);
  requestTurnEnd(state);
  const after = liveHtml(state, null, ui);
  assert.match(after, /data-security-uid=/);
  assert.match(after, /待機選択を終えてターン交代/);
});

test("legal placement projects slots without modifying game state, and Script uses back only", () => {
  const state = clean(), ob = add(state, "STD-020"), script = add(state, "STD-001");
  const before = JSON.stringify(state);
  assert.equal(executionSlots(state, "player", ob.uid).length, 10);
  const slots = executionSlots(state, "player", script.uid);
  assert.equal(slots.length, 5); assert.ok(slots.every(slot => slot.zone === "back"));
  assert.equal(JSON.stringify(state), before);
  assert.equal(playCard(state, "player", script.uid, slots[3].options), true);
  assert.equal(findCard(state, script.uid).card.boardSlot, 4);
  assert.equal(findCard(state, script.uid).card.faceDown, true);
});

test("mount placement offers the occupied Code slot and preserves its position", () => {
  const state = clean(), code = add(state, "STD-008"), ob = add(state, "STD-020");
  assert.equal(playCard(state, "player", code.uid, { zone: "front", requestedSlot: 4 }), true);
  const slot = executionSlots(state, "player", ob.uid).find(slot => slot.zone === "front" && slot.slot === 4);
  assert.equal(slot.options.baseUid, code.uid);
  assert.equal(playCard(state, "player", ob.uid, slot.options), true);
  assert.equal(findCard(state, ob.uid).card.boardSlot, 4);
  assert.equal(findCard(state, ob.uid).card.mounted[0].uid, code.uid);
});

test("layered source chooses an exact slot including one freed by its materials", () => {
  const state = createGame({ mode: "tutorial", tutorialId: "vengeance" });
  state.mode = "lab"; state.players.player.memory = 30;
  const card = state.players.player.hand.find(card => card.id === "STD-195");
  const materials = state.players.player.front.filter(card => card.id === "STD-189").map(card => card.uid);
  assert.equal(canPlayLayeredCard(state, "player", card.uid, materials, "front", 5).ok, true);
  assert.equal(playLayeredCard(state, "player", card.uid, materials, "front", { requestedSlot: 5 }), true);
  assert.equal(findCard(state, card.uid).card.boardSlot, 5);
  assert.equal(findCard(state, card.uid).card.mounted.length, 2);
});

test("relog explicit destination does not choose the first free slot", () => {
  const state = clean(), card = add(state, "STD-020");
  playCard(state, "player", card.uid, { zone: "front", requestedSlot: 2 });
  state.selectedUid = card.uid;
  assert.match(liveHtml(state, null, ui), /バックへ再実行（MEM 1）/);
  const memoryBefore = state.players.player.memory;
  assert.equal(livePlacementSlots(state, { type: "placement", kind: "relog", sourceUid: card.uid, zone: "back" }).length, 5);
  assert.equal(relogCard(state, "player", card.uid, "back", { requestedSlot: 4 }), true);
  assert.equal(findCard(state, card.uid).card.boardSlot, 4);
  assert.equal(state.players.player.memory, memoryBefore - card.cost);
  assert.ok(state.log.some((entry) => /バックへ再実行。メモリ1支払い/.test(entry.text)));
});

test("resolved trigger thread no longer covers the board", () => {
  const state = clean();
  state.triggerThread = { status: "resolved", message: "スレッドが解決しました", items: [] };
  assert.equal(triggerThreadHtml(state), "");
  assert.equal(liveHtml(state, null, ui).includes("trigger-thread-panel"), false);
});

test("AI suspends at another player's required choice without issuing another command", () => {
  const state = clean(); state.active = "ai"; state.interactive = true;
  const request = createSelectionRequest({ mode: "scope", scopeField: "test", scopeOptions: ["続行"], continuation: { type: "test", playerId: "player" } });
  state.pending = { type: "selection", validTargets: [], request };
  const before = JSON.stringify(state), iterator = runSimpleAiTurnSteps(state, "ai");
  assert.equal(iterator.next().value.type, "await-input");
  assert.equal(JSON.stringify(state), before);
  state.pending = null;
  assert.notEqual(iterator.next().value?.type, "await-input");
  iterator.return();
});

test("live shells separate board, hand, details and commands; no undo or manual guide-position buttons", () => {
  const state = clean(); const selected = add(state, "STD-020"); state.selectedUid = selected.uid;
  const html = liveHtml(state, null, { ...ui, detailUid: state.selectedUid });
  assert.match(html, /data-layer="board"/); assert.match(html, /data-layer="hand"/);
  assert.match(html, /data-layout="desktop"/); assert.doesNotMatch(html, /data-layout="mobile"/);
  assert.match(liveHtml(state, null, { ...ui, view: "mobile" }), /data-layout="mobile"/);
  assert.doesNotMatch(html, /data-action="undo"|data-tutorial-position/);
  const flow = createTutorialFlow(); completeTutorialIntroduction(flow); state.mode = "tutorial";
  assert.match(liveHtml(state, flow, ui), /スキップして自由盤面へ/);
});

test("guide chooses a non-overlapping viewport corner without changing board geometry", () => {
  const pos = avoidFocus({ width: 220, height: 120 }, [{ left: 510, top: 50, right: 800, bottom: 210 }], { width: 844, height: 390 });
  assert.equal(pos.overlap, 0); assert.equal(pos.left, 8);
  assert.ok(pos.top >= 8 && pos.top + 120 <= 382);
});

test("ADV guide restores the portrait above speech without decorative phase labels", () => {
  for (const tutorialId of ["basics", "vengeance"]) {
    const state = createGame({ mode: "tutorial", tutorialId });
    const flow = createTutorialFlow(tutorialId);
    const before = JSON.stringify({ state, flow });
    for (const view of ["pc", "mobile"]) {
      const html = liveHtml(state, flow, { ...ui, view });
      assert.match(html, /live-guide-cast.*<img[^>]+alt="じぐさぽの立ち絵"/);
      assert.ok(html.indexOf('live-guide-cast') < html.indexOf('live-guide-speech'));
      assert.match(html, /role="region" aria-label="チュートリアルのセリフ"/);
      assert.match(html, /data-action="dismiss-tutorial-overlay"/);
      assert.match(html, /aria-label="スキップして自由盤面へ"/);
      assert.doesNotMatch(html, /01\s*\/\s*INTRO|data-tutorial-position/);
    }
    assert.equal(JSON.stringify({ state, flow }), before);
    completeTutorialIntroduction(flow);
    flow.error = '<wrong action>';
    state.pending = { type: "required" };
    const html = liveHtml(state, flow, ui);
    assert.match(html, /role="alert">&lt;wrong action&gt;/);
    assert.match(html, /data-live="skip"[^>]*disabled/);
    assert.doesNotMatch(html, /data-action="dismiss-tutorial-overlay"/);
  }
});

test("ADV enlarges speech area by 15 percent without resizing the portrait or width", () => {
  for (const [width, height] of [[844,390], [667,375], [1280,720], [1920,1080], [300,180]]) {
    const box = guideSize({ width, height });
    const scale = Math.min(1, Math.sqrt(width * height * .2 / (300 * 220)), (width - 16) / 300, (height - 16) / 220);
    const oldCast = Math.min(110 * scale, Math.max(0, 220 * scale - 110));
    const oldSpeech = 220 * scale - oldCast;
    assert.equal(box.width, 300 * scale);
    assert.equal(box.castHeight, oldCast);
    assert.ok(Math.abs((box.height - box.castHeight) / oldSpeech - 1.15) < 1e-8);
    assert.ok(box.width * box.height <= width * height * .23 + 1e-8);
    assert.ok(box.width <= width - 16 && box.height <= height - 16);
    assert.ok(box.castHeight < box.height);
    const pos = avoidFocus(box, [], { left: 24, top: 8, width, height });
    assert.ok(pos.left >= 32 && pos.top >= 16);
    assert.ok(pos.left + box.width <= 24 + width - 8 + 1e-8);
  }
});

test("ADV guide can avoid panels in a middle gap when all four corners are occupied", () => {
  const pos = avoidFocus({ width: 260, height: 190 }, [
    { left: 8, right: 238, top: 8, bottom: 360 },
    { left: 540, right: 660, top: 8, bottom: 360 },
    { left: 245, right: 520, top: 230, bottom: 370 }
  ], { width: 667, height: 375 });
  assert.equal(pos.overlap, 0);
  assert.ok(pos.left >= 246 && pos.left + 260 <= 532);
});
