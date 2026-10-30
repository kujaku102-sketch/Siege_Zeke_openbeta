import { isObCard } from "../../card-types.js";
import { createChoiceSpec, createSelectionRequest, selectionRequestFromSpec } from "../../selection-model.js";
import { dealCardDamage } from "../../core/battle.js";
import { findCard, otherPlayer } from "../../core/shared.js";
import { drawCards } from "../../core/turn.js";
import { destroyCard } from "../generic/placement.js";

export function continueStd163Choices(state, continuation, remaining) {
  if (remaining <= 0) return true;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
    label: `残り${remaining}回：①または②`, message: continuation.sourceName,
    continuation: { type: "std163-choice", playerId: continuation.playerId, sourceName: continuation.sourceName, remaining }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function std163DestroySelection(state, continuation, result, playerId, player) {
  for (const uid of result.selected) destroyCard(state, playerId, uid, { source: continuation.sourceName });
  state.pending = null;
  if (!result.selected.length) return true;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
    label: `残り${result.selected.length}回：①または②`, message: continuation.sourceName,
    continuation: { type: "std163-choice", playerId, sourceName: continuation.sourceName, remaining: result.selected.length }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function std163ChoiceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (result.choice.startsWith("①")) {
    drawCards(state, playerId, 2);
    return continueStd163Choices(state, continuation, continuation.remaining - 1);
  }
  const opponentId = otherPlayer(playerId);
  const candidates = [...state.players[opponentId].front, ...state.players[opponentId].back].filter(isObCard);
  if (!candidates.length) return continueStd163Choices(state, continuation, continuation.remaining - 1);
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "3ダメージを与える相手Ob", message: continuation.sourceName,
    continuation: { ...continuation, type: "std163-damage", remaining: continuation.remaining - 1 } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std163DamageSelection(state, continuation, result, playerId, player) {
  const target = findCard(state, result.selected[0]);
  if (target) dealCardDamage(state, target.playerId, target.card.uid, 3, continuation.sourceName, { sourcePlayerId: playerId });
  state.pending = null;
  return continueStd163Choices(state, continuation, continuation.remaining);
}
