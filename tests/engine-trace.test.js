import test from "node:test";
import assert from "node:assert/strict";
import { createCardInstance } from "../src/data/cards.js";
import { addLog } from "../src/game/core/shared.js";
import { EFFECT_OPERATION_TYPES } from "../src/game/effect-operation-library.js";
import { RULE_ORIGINS, TRACE_TAGS, ruleOrigin, setTraceSink } from "../src/game/engine-trace.js";
import { activateScript, attack, createGame, declinePrompt, destroyCard, endTurn, playCard, resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice } from "../src/game/engine.js";
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

// Where a record comes from: a card's own processing, or one of the rules' named processes (a closed list).
const validOrigin = (record) => record.origin?.kind === "card"
  ? typeof record.origin.cardUid === "string"
  : record.origin?.kind === "rule" && Object.values(RULE_ORIGINS).includes(record.origin.name);

test("every record names its origin: a card, or one of the rules' processes", () => {
  const all = [];
  all.push(...collect(() => playScenario()));
  const reboot = createGame({ mode: "lab", rng: () => 0.5 });
  const sp = createCardInstance("STD-010", "player", 10102);
  reboot.players.player.hand = [sp]; reboot.players.player.memory = 5;
  all.push(...collect(() => playCard(reboot, "player", sp.uid)));
  const backup = createGame({ mode: "lab", rng: () => 0.5 });
  const hero = createCardInstance("STD-029", "player", 2902);
  hero.summoningSick = false; backup.players.player.front = [hero];
  all.push(...collect(() => runEffectEntry(backup, "test", "player", () => destroyCard(backup, "player", hero.uid, { source: "test" }), ruleOrigin(RULE_ORIGINS.PLAYER_ACTION))));
  assert.ok(all.length > 0);
  const bad = all.filter((record) => !validOrigin(record));
  assert.deepEqual(bad.map((record) => `${record.tag}:${record.event ?? record.via ?? record.op}`), []);
  // a card's own text is attributed to it, and a backup that replaces a destruction comes from the protected card
  assert.ok(all.some((record) => record.tag === TRACE_TAGS.LAUNCH && record.via === "trigger" && record.origin.kind === "card" && record.origin.cardId === record.cardId));
  assert.ok(all.some((record) => record.tag === TRACE_TAGS.REPLACE && record.kind === "backup" && record.origin.cardId === "STD-029"));
});

test("the rules' own work is attributed by name: turn start and end, the rule draw, delayed effects, the state check, the judgement", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  state.sandboxUi = { alternateTurns: true };
  const danger = createCardInstance("STD-006", "player", 600601); danger.faceDown = false;
  const lost = createCardInstance("STD-154", "player", 15401);
  state.players.player.registry = [danger];
  state.players.player.deck = Array.from({ length: 10 }, (_, i) => createCardInstance("STD-020", "player", 700 + i));
  state.players.player.memory = 0;
  state.players.player.front = [lost];
  const records = collect(() => {
    runEffectEntry(state, "test", "player", () => destroyCard(state, "player", lost.uid, { source: "test", suppressReplacement: true }), ruleOrigin(RULE_ORIGINS.PLAYER_ACTION));
    endTurn(state); endTurn(state); endTurn(state); endTurn(state);
  });
  const names = new Set(records.filter((record) => record.origin?.kind === "rule").map((record) => record.origin.name));
  for (const name of [RULE_ORIGINS.TURN_START, RULE_ORIGINS.TURN_END, RULE_ORIGINS.RULE_DRAW, RULE_ORIGINS.DELAYED, RULE_ORIGINS.STATE_CHECK, RULE_ORIGINS.VICTORY_JUDGE]) assert.ok(names.has(name), name);
  assert.deepEqual(records.filter((record) => !validOrigin(record)), []);
  // the turn-time rule: STD-006 has no 自分/相手, so it runs in both users' turns, and the record says which
  const timing = records.filter((record) => record.via === "turn-timing" && record.cardId === "STD-006");
  assert.ok(timing.some((record) => record.scope === "own-turn") && timing.some((record) => record.scope === "other-turn"));
  assert.ok(timing.every((record) => record.eachTurn === true && record.origin.kind === "rule"));
  assert.ok(records.some((record) => record.event === "turn-start-delayed" && record.cardUid === lost.uid && record.origin.name === RULE_ORIGINS.DELAYED));
});

test("an execution held, declined or replaced by a Script is traced as 置換 from that Script", () => {
  const run = (answer) => {
    const state = createGame({ mode: "lab", rng: () => 0.5 });
    const owner = state.players.player; const opponent = state.players.ai;
    const takeover = owner.hand.find((card) => card.id === "STD-204");
    playCard(state, "player", takeover.uid, { zone: "back" });
    owner.hand = owner.hand.filter((card) => card.id !== "STD-179");
    state.active = "ai"; opponent.memory = 99;
    const executed = createCardInstance("STD-020", "ai", 20401);
    opponent.hand = [executed];
    return collect(() => {
      playCard(state, "ai", executed.uid, { zone: "front", force: true, free: true, ignoreColor: true });
      if (answer === "decline") declinePrompt(state); else activateScript(state, "player", takeover.uid);
    });
  };
  for (const [answer, last] of [["decline", "execution-declined"], ["activate", "execution-replaced"]]) {
    const records = run(answer);
    const replace = records.filter((record) => record.tag === TRACE_TAGS.REPLACE && record.kind === "execution");
    assert.deepEqual(replace.map((record) => record.event), ["execution-held", last], answer);
    assert.ok(replace.every((record) => record.origin.kind === "card" && record.origin.cardId === "STD-204" && record.cardId === "STD-020"), answer);
    assert.deepEqual(records.filter((record) => !validOrigin(record)), [], answer);
  }
});
