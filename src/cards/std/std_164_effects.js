import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { addLog, findCard, otherPlayer } from "../../game/core/shared.js";
import { resumeTriggerThreadAfterSelection } from "../../game/core/triggers.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_164.js)
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
    label: "[負荷]を与える相手Ob", message: continuation.sourceName,
    continuation: { type: "std164-poison", playerId, sourceName: continuation.sourceName, triggerItemId: continuation.triggerItemId } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std164PoisonSelection(state, continuation, result, playerId, player) {
  const target = findCard(state, result.selected[0])?.card;
  if (target) {
    target.load = Number(target.load ?? 0) + 2;
    addLog(state, `${continuation.sourceName}: ${target.name}へ[負荷]2。`, "effect");
  }
  state.pending = null;
  resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
  return true;
}
