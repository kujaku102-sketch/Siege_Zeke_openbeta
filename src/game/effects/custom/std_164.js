import { isObCard } from "../../card-types.js";
import { createSelectionRequest } from "../../selection-model.js";
import { findCard, otherPlayer } from "../../core/shared.js";
import { resumeTriggerThreadAfterSelection } from "../../core/triggers.js";
import { moveCardToTrash } from "../generic/placement.js";

export function std164ChoiceSelection(state, continuation, result, playerId, player) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  state.pending = null;
  if (result.choice.startsWith("①")) {
    if (opponent.hand.length) moveCardToTrash(state, opponentId, opponent.hand.shift(), continuation.sourceName ?? "手札破棄");
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  const candidates = [...opponent.front, ...opponent.back].filter(isObCard);
  if (!candidates.length) {
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    label: "毒カウンターを置く相手Ob", message: continuation.sourceName,
    continuation: { type: "std164-poison", playerId, sourceName: continuation.sourceName, triggerItemId: continuation.triggerItemId } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std164PoisonSelection(state, continuation, result, playerId, player) {
  const target = findCard(state, result.selected[0])?.card;
  if (target) {
    target.counters ??= {};
    target.counters.poison = Number(target.counters.poison ?? 0) + 2;
  }
  state.pending = null;
  resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
  return true;
}
