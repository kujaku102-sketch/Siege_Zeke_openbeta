import test from "node:test";
import assert from "node:assert/strict";
import { createCardInstance } from "../src/data/cards.js";
import { addLog } from "../src/game/core/shared.js";
import { EFFECT_OPERATION_TYPES } from "../src/game/effect-operation-library.js";
import { TRACE_TAGS, setTraceSink } from "../src/game/engine-trace.js";
import { attack, createGame, resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice } from "../src/game/engine.js";

// Two triggers fire at once (a trigger thread), one needs a choice, a drag placement follows.
function playScenario() {
  let calls = 0;
  const state = createGame({ mode: "ai", rng: () => { calls += 1; return 0.5; } });
  state.interactive = true;
  const ownSource = createCardInstance("STD-131", "player", 131301);
  const enemySource = createCardInstance("STD-131", "ai", 131302);
  const ownCopy = createCardInstance("STD-131", "player", 131303);
  const enemyCopy = createCardInstance("STD-131", "ai", 131304);
  ownSource.damage = 2; ownSource.summoningSick = false;
  enemySource.damage = 2; enemySource.sleep = true;
  state.players.player.front = [ownSource]; state.players.player.hand = [ownCopy];
  state.players.ai.front = [enemySource]; state.players.ai.hand = [enemyCopy];
  attack(state, "player", ownSource.uid, enemySource.uid);
  const item = state.triggerThread.items.find((entry) => entry.controllerId === "player" && entry.status === "pending");
  resolveTriggerChoice(state, item.id);
  resolveCardSelection(state, state.pending.request.continuation, { selected: [ownCopy.uid] });
  resolveAccessDragPlacement(state, "player", "front");
  resolveCardSelection(state, state.pending.request.continuation, { selected: [enemyCopy.uid] });
  resolveAccessDragPlacement(state, "ai", "front");
  return { state, calls };
}

const stable = (state) => JSON.stringify({ ...state, log: state.log.map(({ id: _id, ...entry }) => entry) });

test("the trace is ordered, closed in its vocabulary, and changes neither the game nor the RNG", () => {
  setTraceSink(null);
  const off = playScenario();
  const records = [];
  setTraceSink((record) => records.push(record));
  const on = playScenario();
  setTraceSink(null);

  assert.equal(on.calls, off.calls);
  assert.equal(stable(on.state), stable(off.state));
  assert.ok(records.length > 0);
  records.forEach((record, index) => {
    assert.equal(record.seq, index + 1);
    assert.ok("effectId" in record);
    assert.ok(Object.values(TRACE_TAGS).includes(record.tag), record.tag);
    assert.ok(record.op === null || Object.values(EFFECT_OPERATION_TYPES).includes(record.op), record.op);
  });
  for (const tag of [TRACE_TAGS.LAUNCH, TRACE_TAGS.TRIGGER, TRACE_TAGS.SELECT, TRACE_TAGS.JUDGE]) {
    assert.ok(records.some((record) => record.tag === tag), tag);
  }
  assert.ok(records.some((record) => record.tag === TRACE_TAGS.TRIGGER && record.event === "thread-opened"));
  assert.ok(records.some((record) => record.tag === TRACE_TAGS.TRIGGER && record.event === "order-chosen"));
});

test("a trace sink is off by default and setTraceSink(null) switches it off", () => {
  const records = [];
  setTraceSink((record) => records.push(record));
  setTraceSink(null);
  playScenario();
  assert.equal(records.length, 0);
});

test("log ids are a deterministic counter that survives the 120-entry cap", () => {
  const first = createGame({ mode: "ai", rng: () => 0.5 });
  const second = createGame({ mode: "ai", rng: () => 0.5 });
  for (const state of [first, second]) for (let i = 0; i < 130; i += 1) addLog(state, `entry ${i}`);
  assert.deepEqual(first.log.map((entry) => entry.id), second.log.map((entry) => entry.id));
  assert.equal(first.log.length, 120);
  assert.equal(new Set(first.log.map((entry) => entry.id)).size, 120);
  const ids = first.log.map((entry) => Number(entry.id.slice(1)));
  assert.ok(ids.every((id, index) => index === 0 || id === ids[index - 1] + 1));
});
