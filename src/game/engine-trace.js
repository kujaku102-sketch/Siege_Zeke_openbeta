// Engine trace: an ordered record of what the engine does, for tests. It is a development and test tool: the product build
// leaves it out (see TRACE). It lives outside `state` (so STATE_KEYS, the journal and the snapshot are untouched) and never
// draws from the RNG.
//
// setTraceSink(fn)   fn(record) receives every record in order; setTraceSink(null) switches the trace off.
// trace(state, rec)  rec = { tag, op, ...fields }. `op` is one of EFFECT_OPERATION_TYPES, or null when the record is
//                    not about one operation. seq and effectId (state.effectResolution?.id) are added here; a record
//                    may override effectId when the resolution it describes is already closing.
//
// Every call site has the form   if (TRACE && tracing()) trace(state, { ... });
//   TRACE     a build-time constant. true when the engine runs from source (node, the tests); the product build sets
//             __SZ_TRACE__ to false (vite `define`), so the whole `if` - and the record built inside it - is removed.
//   tracing() whether a sink is set. With no sink nothing inside the `if` runs, so no record is built.
// Nothing inside such an `if` may change the game or draw from the RNG.
//
// What is recorded: where a piece of work starts (起動, via "entry" or "trigger"), the waypoints it passes, and where it ends
// (判定 "out", or a refused action's 条件 record). A waypoint (通過点) is the id of a piece of the runtime that was used and
// whether it held (`ok`): see docs "追跡の通過点". The older per-tag records stay while the checks that read them are rewritten.
export const TRACE_TAGS = Object.freeze({
  LAUNCH: "起動",
  CONDITION: "条件",
  COST: "コスト",
  BRANCH: "分岐",
  SELECT: "選択",
  REPLACE: "置換",
  RESULT: "結果",
  TRIGGER: "誘発",
  CLEANUP: "後始末",
  JUDGE: "判定",
  WAYPOINT: "通過点"
});

// The rules' own steps a waypoint can name as `rule:<step>`. Closed: waypoint() refuses any other.
export const RULE_STEPS = Object.freeze([
  "turn-start", "turn-end", "turn-timing", "rule-draw", "delayed-effect", "state-check:in", "state-check:out", "state-check:skipped",
  "pay-execution-cost", "execution", "source-cleanup", "placement-limit", "trigger-order", "execution-replacement"
]);

// Waypoint ids are `<kind>:<name>`. These kinds are the only ones.
export const WAYPOINT_KINDS = Object.freeze(["rule", "spec", "op", "cond", "trigger", "trigger-body", "choice", "custom"]);

// eslint-disable-next-line no-undef
export const TRACE = typeof __SZ_TRACE__ === "undefined" ? true : __SZ_TRACE__;

let sink = null;
let seq = 0;

export function setTraceSink(fn) {
  sink = typeof fn === "function" ? fn : null;
  seq = 0;
}

// Whether a sink is set. Call sites test `TRACE && tracing()` before building a record.
export function tracing() {
  return sink !== null;
}

export function trace(state, record) {
  if (!sink) return;
  sink({ seq: ++seq, effectId: state?.effectResolution?.id ?? null, op: null, ...record });
}

// A waypoint: the runtime piece `id` was used, and `ok` says whether it held (a condition true, a spec found, an operation applied,
// a custom handler that took the case). `fields` are identity details of the record (card id, trigger id), not results.
export function waypoint(state, id, ok, fields = {}) {
  const kind = id.slice(0, id.indexOf(":"));
  if (!WAYPOINT_KINDS.includes(kind)) throw new Error(`Unknown waypoint kind: ${id}`);
  if (kind === "rule" && !RULE_STEPS.includes(id.slice(5))) throw new Error(`Unknown rule step: ${id}`);
  trace(state, { tag: TRACE_TAGS.WAYPOINT, id, ok: Boolean(ok), ...fields });
}
