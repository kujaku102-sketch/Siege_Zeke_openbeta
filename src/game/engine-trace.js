// Engine trace: an ordered record of what the engine does, for tests. It lives outside `state` (so STATE_KEYS, the
// journal and the snapshot are untouched) and never draws from the RNG. With no sink set, trace() costs one test.
//
// setTraceSink(fn)   fn(record) receives every record in order; setTraceSink(null) switches the trace off.
// trace(state, rec)  rec = { tag, op, ...fields }. `op` is one of EFFECT_OPERATION_TYPES, or null when the record is
//                    not about one operation. seq and effectId (state.effectResolution?.id) are added here; a record
//                    may override effectId when the resolution it describes is already closing.
//
// Origin: every record also carries `origin`, where the work comes from. It is { kind: "card", cardId, cardUid } for a card's own
// processing, or { kind: "rule", name } for the rules' (name is one of RULE_ORIGINS, a closed vocabulary). trace() reads it from the
// origin stack that withOrigin() maintains around each card's or rule's processing, so a call site never writes it; only a record
// about a card other than the one being processed (the replacing Script, say) passes `origin` itself. With no sink the stack is not kept.
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

// The rules' own processing a record can come from. Closed: ruleOrigin() refuses any other name.
export const RULE_ORIGINS = Object.freeze({
  TURN_START: "turn-start",
  TURN_END: "turn-end",
  RULE_DRAW: "rule-draw",
  STATE_CHECK: "state-check",
  DELAYED: "delayed-effect",
  VICTORY_JUDGE: "victory-judge",
  PLACEMENT_LIMIT: "placement-limit",
  TRIGGER_ORDER: "trigger-order",
  PLAYER_CHOICE: "player-choice",
  PLAYER_ACTION: "player-action",
  USER_ABILITY: "user-ability"
});

export const cardOrigin = (card) => Object.freeze({ kind: "card", cardId: card?.id ?? card?.cardId ?? null, cardUid: card?.uid ?? card?.cardUid ?? null });

export function ruleOrigin(name) {
  if (!Object.values(RULE_ORIGINS).includes(name)) throw new Error(`Unknown trace rule origin: ${name}`);
  return Object.freeze({ kind: "rule", name });
}

let sink = null;
let seq = 0;
const originStack = [];

export function setTraceSink(fn) {
  sink = typeof fn === "function" ? fn : null;
  seq = 0;
  originStack.length = 0;
}

// Runs fn with `origin` (an object, or a function returning one, evaluated only when a sink is set) as what the records inside come from.
export function withOrigin(origin, fn) {
  if (!sink || origin === null || origin === undefined) return fn();
  const resolved = typeof origin === "function" ? origin() : origin;
  if (!resolved) return fn();
  originStack.push(resolved);
  try {
    return fn();
  } finally {
    originStack.pop();
  }
}

// For callers that would otherwise build an expensive record: ask first.
export function traceActive() {
  return sink !== null;
}

export function trace(state, record) {
  if (!sink) return;
  sink({ seq: ++seq, effectId: state?.effectResolution?.id ?? null, op: null, origin: originStack.at(-1) ?? null, ...record });
}
