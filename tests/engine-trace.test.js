import test from "node:test";
import assert from "node:assert/strict";
import { createCardInstance } from "../src/data/cards.js";
import { addLog } from "../src/game/core/shared.js";
import { EFFECT_OPERATION_TYPES } from "../src/game/effect-operation-library.js";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RULE_STEPS, TRACE, TRACE_TAGS, WAYPOINT_KINDS, setTraceSink, tracing, waypoint } from "../src/game/engine-trace.js";
import { activateScript, attack, createGame, declinePrompt, destroyCard, endTurn, playCard, resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice } from "../src/game/engine.js";
import { runEffectEntry } from "../src/game/core/effects.js";
import { drawCards } from "../src/game/core/draw.js";

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

// ---- waypoints (通過点): the id of a piece of the runtime that was used, and whether it held

const wp = (records) => records.filter((record) => record.tag === TRACE_TAGS.WAYPOINT);
const wpIds = (records) => new Set(wp(records).map((record) => record.id));

test("a waypoint is an id of a known kind and a boolean; unknown kinds and rule steps are refused", () => {
  assert.equal(TRACE, true);
  const records = collect(() => { playScenario(); });
  assert.ok(wp(records).length > 0);
  for (const record of wp(records)) {
    assert.ok(WAYPOINT_KINDS.includes(record.id.slice(0, record.id.indexOf(":"))), record.id);
    assert.equal(typeof record.ok, "boolean", record.id);
    if (record.id.startsWith("rule:")) assert.ok(RULE_STEPS.includes(record.id.slice(5)), record.id);
  }
  setTraceSink(() => {});
  try {
    assert.throws(() => waypoint(null, "nope:x", true));
    assert.throws(() => waypoint(null, "rule:not-a-step", true));
  } finally { setTraceSink(null); }
});

test("a trigger's conditions, the trigger itself and its text are waypoints; a failing condition ends the list", () => {
  const draw = createGame({ mode: "sandbox", rng: () => 0.5 });
  const harvest = createCardInstance("STD-186", "player", 18601); harvest.faceDown = true; harvest.color = null;
  draw.players.player.back = [harvest]; draw.players.player.memory = 5;
  draw.players.ai.deck = Array.from({ length: 4 }, (_, i) => createCardInstance("STD-020", "ai", 900 + i));
  const drawRecords = collect(() => runEffectEntry(draw, "test", "ai", () => { draw.active = "ai"; drawCards(draw, "ai", 1); }));
  const conds = wp(drawRecords).filter((record) => record.id.startsWith("cond:STD-186:"));
  assert.deepEqual(conds.map((record) => record.id.split(":").at(-1)), ["source_zone", "source_face_down", "event_player_is_enemy"]);
  assert.ok(conds.every((record) => record.ok === true));
  assert.equal(wp(drawRecords).find((record) => record.id.startsWith("trigger:STD-186:")).ok, true);
  const own = createGame({ mode: "sandbox", rng: () => 0.5 });
  const mine = createCardInstance("STD-186", "player", 18602); mine.faceDown = true;
  own.players.player.back = [mine]; own.players.player.deck = Array.from({ length: 4 }, (_, i) => createCardInstance("STD-020", "player", 910 + i));
  const ownRecords = collect(() => runEffectEntry(own, "test", "player", () => drawCards(own, "player", 1)));
  const failed = wp(ownRecords).filter((record) => record.id.startsWith("cond:STD-186:"));
  assert.deepEqual(failed.map((record) => [record.id.split(":").at(-1), record.ok]), [["source_zone", true], ["source_face_down", true], ["event_player_is_enemy", false]]);
  assert.equal(wp(ownRecords).find((record) => record.id.startsWith("trigger:STD-186:")).ok, false);

  const records = collect(() => playScenario());
  const ids = wpIds(records);
  assert.ok(ids.has("trigger-body:end") && ids.has("trigger-body:wait"));
  assert.ok(ids.has("rule:trigger-order") && ids.has("rule:state-check:in") && ids.has("rule:state-check:out"));
  assert.ok([...ids].some((id) => id.startsWith("choice:")));
});

test("an execution passes through the cost, the execution, the card's spec and operations, and the cleanup", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const reboot = createCardInstance("STD-010", "player", 10103);
  state.players.player.hand = [reboot]; state.players.player.memory = 5;
  const records = collect(() => playCard(state, "player", reboot.uid));
  const ids = wp(records).map((record) => record.id);
  assert.ok(ids.indexOf("rule:pay-execution-cost") > -1 && ids.indexOf("rule:pay-execution-cost") < ids.indexOf("rule:execution"));
  assert.ok(ids.some((id) => id.startsWith("op:")));
  assert.ok(ids.indexOf("rule:source-cleanup") > ids.findIndex((id) => id.startsWith("op:")));
  assert.equal(wp(records).find((record) => record.id === "rule:execution").category, "Sp");
});

test("a custom handler, the turn rules, the rule draw, a delayed effect and an execution replacement are waypoints", () => {
  const custom = createGame({ mode: "sandbox", rng: () => 0.5 });
  const cicada = createCardInstance("STD-184", "player", 18401);
  custom.players.player.hand = [cicada]; custom.players.player.memory = 10;
  const customRecords = collect(() => playCard(custom, "player", cicada.uid, { asScript: true, zone: "back", ignoreColor: true }));
  const handler = wp(customRecords).find((record) => record.id === "custom:CUSTOM_PLAY_CARD_CORE:STD-184");
  assert.ok(handler && handler.ok === true);

  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  state.sandboxUi = { alternateTurns: true };
  const danger = createCardInstance("STD-006", "player", 600602); danger.faceDown = false;
  const lost = createCardInstance("STD-154", "player", 15402);
  state.players.player.registry = [danger];
  state.players.player.deck = Array.from({ length: 10 }, (_, i) => createCardInstance("STD-020", "player", 800 + i));
  state.players.player.memory = 0; state.players.player.front = [lost];
  const records = collect(() => {
    runEffectEntry(state, "test", "player", () => destroyCard(state, "player", lost.uid, { source: "test", suppressReplacement: true }));
    endTurn(state); endTurn(state); endTurn(state); endTurn(state);
  });
  const ids = wpIds(records);
  for (const id of ["rule:turn-start", "rule:turn-end", "rule:rule-draw", "rule:delayed-effect", "rule:turn-timing", "spec:STD-006:turn_start", "spec:STD-006:turn_end"]) assert.ok(ids.has(id), id);
  const timing = wp(records).filter((record) => record.id === "rule:turn-timing" && record.cardId === "STD-006");
  assert.ok(timing.some((record) => record.scope === "own-turn") && timing.some((record) => record.scope === "other-turn"));
  assert.ok(timing.every((record) => record.eachTurn === true));

  const run = (answer) => {
    const game = createGame({ mode: "lab", rng: () => 0.5 });
    const owner = game.players.player; const opponent = game.players.ai;
    const takeover = owner.hand.find((card) => card.id === "STD-204");
    playCard(game, "player", takeover.uid, { zone: "back" });
    owner.hand = owner.hand.filter((card) => card.id !== "STD-179");
    game.active = "ai"; opponent.memory = 99;
    const executed = createCardInstance("STD-020", "ai", 20402);
    opponent.hand = [executed];
    return collect(() => {
      playCard(game, "ai", executed.uid, { zone: "front", force: true, free: true, ignoreColor: true });
      if (answer === "decline") declinePrompt(game); else activateScript(game, "player", takeover.uid);
    });
  };
  for (const [answer, last, ok] of [["decline", "declined", false], ["activate", "replaced", true]]) {
    const replacement = wp(run(answer)).filter((record) => record.id === "rule:execution-replacement");
    assert.deepEqual(replacement.map((record) => record.event), ["held", last], answer);
    assert.equal(replacement.at(-1).ok, ok, answer);
  }
});

test("with no sink nothing is recorded, and every trace call in the engine sits behind TRACE && tracing()", () => {
  assert.equal(tracing(), false);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(root);
  const guard = /TRACE && tracing\(\)/;
  const call = /(^|[^A-Za-z.])(trace|waypoint)\(\s*[A-Za-z?.]+,/;
  const unguarded = [];
  let sites = 0;
  for (const file of files) {
    if (file.endsWith("engine-trace.js")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    const indentOf = (line) => line.length - line.trimStart().length;
    lines.forEach((line, index) => {
      if (!call.test(line) || /^\s*(export )?(async )?function /.test(line) || /^\s*\/\//.test(line)) return;
      sites += 1;
      if (guard.test(line)) return;
      // inside a guarded block: walk up through the lines that open the enclosing blocks
      let at = index; let guarded = false;
      while (at > 0 && !guarded) {
        const here = indentOf(lines[at]);
        let up = at - 1;
        while (up >= 0 && (lines[up].trim() === "" || indentOf(lines[up]) >= here)) up -= 1;
        if (up < 0) break;
        if (guard.test(lines[up])) guarded = true;
        at = up;
      }
      if (!guarded) unguarded.push(path.relative(root, file) + ":" + (index + 1));
    });
  }
  assert.ok(sites > 40, "found the call sites: " + sites);
  assert.deepEqual(unguarded, []);
});
