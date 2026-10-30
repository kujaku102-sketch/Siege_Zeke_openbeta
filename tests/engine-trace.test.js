import test from "node:test";
import assert from "node:assert/strict";
import { createCardInstance } from "../src/data/cards.js";
import { addLog } from "../src/game/core/shared.js";
import { EFFECT_OPERATION_TYPES } from "../src/game/effect-operation-library.js";
import { TRACE_TAGS, setTraceSink } from "../src/game/engine-trace.js";
import { attack, createGame, destroyCard, playCard, resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice } from "../src/game/engine.js";
import { runEffectEntry } from "../src/game/core/effects.js";

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

const stable = (state) => JSON.stringify(state);

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
  for (const tag of [TRACE_TAGS.LAUNCH, TRACE_TAGS.TRIGGER, TRACE_TAGS.SELECT, TRACE_TAGS.JUDGE, TRACE_TAGS.RESULT]) {
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

function collect(run) {
  const records = [];
  setTraceSink((record) => records.push(record));
  try { run(); } finally { setTraceSink(null); }
  return records;
}

test("an Sp is cleaned up (trash) inside its effect, before the judgement closes it", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const reboot = createCardInstance("STD-010", "player", 10101);
  state.players.player.hand = [reboot]; state.players.player.memory = 5;
  const records = collect(() => playCard(state, "player", reboot.uid));
  const order = records.map((record) => record.tag + (record.event ? ":" + record.event : "") + (record.phase ? ":" + record.phase : ""));
  const cleanup = order.indexOf("後始末:spell-to-trash");
  assert.ok(cleanup > order.indexOf("起動"));
  assert.ok(cleanup < order.indexOf("判定:out"));
  assert.ok(records.some((record) => record.tag === TRACE_TAGS.RESULT && record.event === "card_executed"));
});

test("a destruction attempt and the backup that replaces it are both traced, in that order", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const hero = createCardInstance("STD-029", "player", 2901);
  hero.summoningSick = false;
  state.players.player.front = [hero];
  const records = collect(() => destroyCard(state, "player", hero.uid, { source: "test" }));
  const replace = records.filter((record) => record.tag === TRACE_TAGS.REPLACE);
  assert.deepEqual(replace.map((record) => record.event + ":" + (record.kind ?? "")), ["attempt:", "replaced:backup"]);
  assert.equal(state.players.player.back[0]?.uid, hero.uid);
});

test("a refused action leaves a failed 条件 record", () => {
  const state = createGame({ mode: "ai", rng: () => 0.5 });
  const card = createCardInstance("STD-020", "player", 2001);
  state.players.player.hand = [card]; state.players.player.memory = 0;
  const records = collect(() => playCard(state, "player", "missing-uid"));
  assert.ok(records.some((record) => record.tag === TRACE_TAGS.CONDITION && record.result === false));
});

test("paying memory goes through one entry and leaves a コスト record with the amount and both balances", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const soldier = createCardInstance("STD-021", "player", 2101);
  state.players.player.hand = [soldier]; state.players.player.memory = 5;
  const records = collect(() => playCard(state, "player", soldier.uid));
  const costs = records.filter((record) => record.tag === TRACE_TAGS.COST);
  assert.equal(costs.length, 1);
  assert.deepEqual([costs[0].op, costs[0].reason, costs[0].playerId, costs[0].amount, costs[0].before, costs[0].after], ["consume_memory", "execution", "player", 2, 5, 3]);
  assert.equal(state.players.player.memory, 3);
  assert.ok(records.findIndex((record) => record.tag === TRACE_TAGS.COST) < records.findIndex((record) => record.tag === TRACE_TAGS.RESULT && record.event === "card_placed"));
});

test("a trigger's text is closed by a body record, the choices it opens are traced, and the state check is bracketed", () => {
  const records = [];
  setTraceSink((record) => records.push(record));
  playScenario();
  setTraceSink(null);
  const launches = records.filter((record) => record.tag === TRACE_TAGS.LAUNCH && record.via === "trigger");
  assert.ok(launches.length >= 2);
  for (const launch of launches) {
    const mine = records.filter((record) => record.tag === TRACE_TAGS.TRIGGER && record.triggerId === launch.triggerId && /^body-/.test(record.event));
    const ends = mine.filter((record) => record.event === "body-end");
    assert.equal(ends.length, 1, launch.triggerId);
    assert.ok(ends[0].seq > launch.seq);
    // a trigger that waited for an answer says so first, and is closed by the answer
    if (mine.some((record) => record.event === "body-wait")) assert.equal(ends[0].how, "answered");
  }
  // the choice a trigger opened shows up between its launch and the end of its text, with who chooses
  const first = launches[0];
  const opened = records.find((record) => record.tag === TRACE_TAGS.SELECT && record.event === "opened" && record.seq > first.seq);
  assert.ok(opened && ["self", "opponent", "random", "auto"].includes(opened.chooser));
  // the state check is bracketed: every "in" is followed by its "out"
  const checks = records.filter((record) => record.tag === TRACE_TAGS.CONDITION && record.event === "state-check");
  assert.ok(checks.length > 0);
  checks.forEach((record, index) => { if (record.phase === "in") assert.equal(checks[index + 1]?.phase, "out"); });
});

test("an answered trigger is judged before the thread's next trigger starts, and that trigger is not inside an open effect", () => {
  const records = [];
  setTraceSink((record) => records.push(record));
  playScenario();
  setTraceSink(null);
  const launches = records.filter((record) => record.tag === TRACE_TAGS.LAUNCH && record.via === "trigger");
  assert.ok(launches.length >= 2);
  const [first, second] = launches;
  const firstEnd = records.find((record) => record.tag === TRACE_TAGS.TRIGGER && record.event === "body-end" && record.triggerId === first.triggerId);
  const judgedBetween = records.some((record) => record.tag === TRACE_TAGS.JUDGE && record.phase === "out" && record.seq > firstEnd.seq && record.seq < second.seq);
  assert.ok(firstEnd.seq < second.seq);
  assert.ok(judgedBetween, "the first trigger's completion is judged before the second one starts");
  assert.equal(second.effectId, null);
});

test("the rule-based state check runs inside the effect: before its judgement, and what it raises waits until after it", () => {
  const state = createGame({ mode: "ai", rng: () => 0.5 });
  const victim = createCardInstance("STD-131", "player", 13101);
  victim.summoningSick = false;
  state.players.player.front = [victim];
  const records = collect(() => runEffectEntry(state, "test", "player", () => { victim.damage = 99; }));
  const order = records.map((record) => record.tag + (record.event ? ":" + record.event : "") + (record.phase ? ":" + record.phase : ""));
  const checkOut = order.indexOf("条件:state-check:out");
  const judgeOut = order.indexOf("判定:out");
  const trigger = records.findIndex((record) => record.tag === TRACE_TAGS.LAUNCH && record.via === "trigger");
  assert.ok(order.includes("置換:attempt"), "the card was destroyed by the state check");
  assert.ok(checkOut > -1 && checkOut < judgeOut);
  assert.ok(trigger === -1 || trigger > judgeOut, "a trigger raised by the destruction starts only after the effect is judged");
});
