import { addLog } from "../../core/shared.js";
import { resumeMandatoryDrawContinuation } from "../../core/turn.js";

export function settleStd048MandatoryPlacement(state, pending, placed) {
  const continuation = state.mandatoryDrawContinuation;
  if (pending?.type !== "std048-draw-place" || !continuation
    || continuation.type !== "std048-mandatory-draw"
    || continuation.sourceUid !== pending.sourceUid
    || continuation.placementOutcome !== "pending") return false;
  continuation.placementOutcome = placed ? "placed" : "failed";
  return resumeMandatoryDrawContinuation(state);
}

export function beginStd048MandatoryDraw(state, playerId, card, remainingRuleDraws) {
  card.dragFree = true;
  state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "STD-048-mandatory-draw", source: card.uid,
    playerId, status: "awaiting-choice"
  };
  state.mandatoryDrawContinuation = {
    type: "std048-mandatory-draw", playerId, sourceUid: card.uid, sourceName: card.name,
    remainingRuleDraws, placementOutcome: "pending", ruleDrawDone: remainingRuleDraws === 0, successEffectDone: false
  };
  state.pending = {
    type: "std048-draw-place", playerId, sourceName: card.name,
    queue: [card.uid], sourceUid: card.uid
  };
  addLog(state, `${card.name}: ルールによる最初のドローで引いた。配置先を選択。`, "effect");
  return true;
}
