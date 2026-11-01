// Engine trace: an ordered record of what the engine does, for tests. It lives outside `state` (so STATE_KEYS, the
// journal and the snapshot are untouched) and never draws from the RNG. With no sink set, trace() costs one test.
//
// setTraceSink(fn)   fn(record) receives every record in order; setTraceSink(null) switches the trace off.
// trace(state, rec)  rec = { tag, op, ...fields }. `op` is one of EFFECT_OPERATION_TYPES, or null when the record is
//                    not about one operation. seq and effectId (state.effectResolution?.id) are added here; a record
//                    may override effectId when the resolution it describes is already closing.
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
  JUDGE: "判定"
});

let sink = null;
let seq = 0;

export function setTraceSink(fn) {
  sink = typeof fn === "function" ? fn : null;
  seq = 0;
}

// For callers that would otherwise build an expensive record: ask first.
export function traceActive() {
  return sink !== null;
}

export function trace(state, record) {
  if (!sink) return;
  sink({ seq: ++seq, effectId: state?.effectResolution?.id ?? null, op: null, ...record });
}
