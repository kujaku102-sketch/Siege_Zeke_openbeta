import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewFixture } from "../src/ui-refresh/fixture.js";
import { beginPlacement, commitPlacement, operationLocked, placementOptions } from "../src/ui-refresh/placement.js";
import { canPlayCard, playCard, resolveCardSelection, cardAtk } from "../src/game/engine.js";
import { confirmSelection, setSelectionScope } from "../src/game/selection-model.js";
import { createCardInstance } from "../src/data/cards.js";
import { popupHtml } from "../src/ui-refresh/view.js";

test("placement planning and abandoning the draft leave the entire engine state unchanged", () => {
  const state = createPreviewFixture();
  const before = JSON.stringify(state);
  const uid = state.players.player.hand[0].uid;
  const choices = placementOptions(state, uid);
  assert.deepEqual(choices.slots, [
    { zone: "front", slot: 3 }, { zone: "front", slot: 4 }, { zone: "front", slot: 5 },
    { zone: "back", slot: 2 }, { zone: "back", slot: 3 }, { zone: "back", slot: 4 }, { zone: "back", slot: 5 }
  ]);
  let draft = beginPlacement(state, uid);
  assert.deepEqual(draft, { type: "placement", sourceUid: uid });
  draft = null;
  assert.equal(commitPlacement(state, draft, "front", 5), false);
  assert.equal(JSON.stringify(state), before);
});

test("each supported Ob executes in the chosen front/back slot, pays once, and finishes", () => {
  for (const id of ["STD-020", "STD-021", "STD-022", "STD-023", "STD-024"]) {
    for (const zone of ["front", "back"]) {
      const state = createPreviewFixture();
      const player = state.players.player;
      const card = player.hand.find(item => item.id === id);
      const memory = player.memory, count = player.hand.length;
      const draft = beginPlacement(state, card.uid);
      assert.equal(commitPlacement(state, draft, zone, 5), true, `${id}/${zone}`);
      assert.equal(player[zone].find(item => item.uid === card.uid).boardSlot, 5);
      assert.equal(player.hand.length, count - 1);
      assert.equal(player.memory, memory - card.cost);
      assert.equal(operationLocked(state), false);
      assert.deepEqual(state.history, []);
      const after = JSON.stringify(state);
      assert.equal(commitPlacement(state, draft, zone, 4), false);
      assert.equal(JSON.stringify(state), after);
    }
  }
});

test("commit revalidates occupancy, memory, turn, symbol and resolution locks without mutation", () => {
  for (const mutate of [
    s => { s.players.player.memory = 0; },
    s => { s.active = "ai"; },
    s => { s.players.player.hand[0].color = "紫"; },
    s => { s.pending = { type: "selection" }; },
    s => { s.prompt = { type: "script-activation" }; },
    s => { s.effectResolution = { id: "in-flight" }; },
    s => { s.winner = "player"; },
    s => { s.victory = { lockedOutcome: "ai" }; },
    s => { s.players.player.front.push(...[1,2,3].map(n => createCardInstance("STD-020", "player", n))); }
  ]) {
    const state = createPreviewFixture();
    const draft = beginPlacement(state, state.players.player.hand[0].uid);
    mutate(state);
    const before = JSON.stringify(state);
    assert.equal(commitPlacement(state, draft, "front", 5), false);
    assert.equal(JSON.stringify(state), before);
  }
});

test("explicit-slot engine API rejects invalid/occupied slots before state changes; default remains first free", () => {
  for (const slot of [0, -1, 1.5, NaN, Infinity, "5", 6, 1, 2]) {
    const state = createPreviewFixture();
    const card = state.players.player.hand[0];
    const before = JSON.stringify(state);
    assert.equal(canPlayCard(state, "player", card, { requestedSlot: slot }).ok, false);
    assert.equal(playCard(state, "player", card.uid, { requestedSlot: slot }), false);
    assert.equal(JSON.stringify(state), before);
  }
  const state = createPreviewFixture(), card = state.players.player.hand[0];
  assert.equal(playCard(state, "player", card.uid), true);
  assert.equal(card.boardSlot, 3);
});

test("trial popup enables only supported hand Ob; other modes and Sp remain disconnected", () => {
  const state = createPreviewFixture();
  const uid = state.players.player.hand[0].uid;
  assert.match(popupHtml(state, uid, { placementEnabled: true }), /data-begin-placement >実行する/);
  assert.doesNotMatch(popupHtml(state, uid), /data-begin-placement/);
  const draft = beginPlacement(state, uid);
  assert.match(popupHtml(state, uid, { placementEnabled: true, draft }), /disabled>配置先を選択中/);
  for (const card of state.players.player.hand.filter(item => item.category !== "Ob")) {
    assert.equal(beginPlacement(state, card.uid), null);
    assert.doesNotMatch(popupHtml(state, card.uid, { placementEnabled: true }), /data-begin-placement/);
  }
});

test("engine preserves an explicit slot through OC choice and resolves login there", () => {
  const state = createPreviewFixture();
  const card = createCardInstance("STD-125", "player", 88001);
  state.players.player.hand.push(card);
  state.players.player.memory = 20;
  state.mode = "lab";
  assert.equal(playCard(state, "player", card.uid, { zone: "back", requestedSlot: 5 }), true);
  assert.equal(state.pending.request.continuation.type, "play-card-oc");
  assert.equal(state.pending.request.continuation.options.requestedSlot, 5);
  assert.ok(state.players.player.hand.includes(card));
  const before = JSON.stringify(state);
  assert.equal(playCard(state, "player", state.players.player.hand[0].uid, { requestedSlot: 3 }), false);
  assert.equal(JSON.stringify(state), before);
  setSelectionScope(state.pending.request, "+4払う");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(card.boardSlot, 5);
  assert.equal(card.boardSlotZone, "back");
  assert.equal(cardAtk(state, "player", card), Number(card.atk) + 2);
  assert.equal(state.players.player.memory, 20 - card.cost - 4);
  assert.equal(operationLocked(state), false);
});

test("explicit-slot engine rejects unsupported paths, busy state and stale legality atomically", () => {
  for (const change of [
    (s, o) => { o.zone = "registry"; },
    (s, o) => { o.baseUid = s.players.player.back[0].uid; },
    (s, o) => { o.underUid = s.players.player.front[0].uid; },
    (s, o) => { o.asScript = true; },
    (s, o) => { o.placementMode = "forced-effect"; },
    s => { s.players.player.memory = 0; },
    s => { s.active = "ai"; },
    s => { s.pending = { type: "selection" }; },
    s => { s.prompt = { type: "script-activation" }; },
    s => { s.effectResolution = { id: "in-flight" }; },
    s => { s.winner = "player"; },
    s => { s.players.player.hand[0].category = "Sp"; },
    s => { s.players.player.hand[0].category = "Script"; }
  ]) {
    const state = createPreviewFixture(), options = { requestedSlot: 5 };
    const uid = state.players.player.hand[0].uid;
    change(state, options);
    const before = JSON.stringify(state);
    assert.equal(playCard(state, "player", uid, options), false);
    assert.equal(JSON.stringify(state), before);
  }
});
