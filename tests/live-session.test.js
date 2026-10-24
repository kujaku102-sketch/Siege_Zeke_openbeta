import test from "node:test";
import assert from "node:assert/strict";
import { createGame, addSandboxCardToHand, findCard, playLayeredCard, canPlayLayeredCard } from "../src/game/engine.js";
import { runSimpleAiTurnSteps } from "../src/game/ai.js";
import { mobileViewportMetrics } from "../src/ui-refresh/mobile-viewport.js";
import { createSelectionRequest } from "../src/game/selection-model.js";

const clean = () => {
  const state = createGame({ mode: "sandbox", sandboxDeckSetup: true, rng: () => .5 });
  state.sandboxUi.alternateTurns = true;
  state.mode = "lab";
  for (const p of Object.values(state.players)) { p.front = []; p.back = []; p.hand = []; p.registry = []; p.memory = 30; }
  return state;
};
const add = (state, id, owner = "player") => { addSandboxCardToHand(state, owner, id); return state.players[owner].hand.at(-1); };
const ui = { view: "pc", screen: "game", handOpen: true, tapDetails: true, detailUid: null, draft: null };

test("mobile layout uses CSS viewport occupancy and remains independent from physical DPR", () => {
  const profiles = [
    [667, 375, 2],
    [844, 390, 3],
    [915, 412, 2.625],
    [932, 430, 3],
    [1280, 720, 2],
    [960, 360, 3],
  ];
  for (const [width, height] of profiles) {
    const atOne = mobileViewportMetrics({ width, height });
    const atDeviceDpr = mobileViewportMetrics({ width, height, devicePixelRatio: 3 });
    assert.deepEqual(atDeviceDpr, atOne);
    assert.ok(atOne.consoleScale >= 0 && atOne.consoleScale <= 1);
    assert.ok(atOne.consoleWidth <= atOne.contentWidth * .25 + .001);
    assert.ok(atOne.playWidth + atOne.consoleWidth + atOne.gutter * 2 <= atOne.contentWidth + .001);
    assert.ok(atOne.playWidth > 0);
  }
  const safe = mobileViewportMetrics({ width: 932, height: 430, safeLeft: 24, safeRight: 12, safeTop: 8, safeBottom: 10 });
  assert.equal(safe.contentWidth, 896);
  assert.equal(safe.contentHeight, 412);
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
