// STD-163 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { createChoiceSpec, createSelectionRequest, selectionRequestFromSpec } from "../../game/selection-model.js";
import { dealCardDamage } from "../../game/core/battle.js";
import { findCard, otherPlayer } from "../../game/core/shared.js";
import { drawCards } from "../../game/core/turn.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_163.js)
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

export function std163ResolveSpell({ player, card, playerId, state }) {
  const candidates = [...player.front, ...player.back].filter(isObCard);
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((target) => target.uid), count: candidates.length, minimum: 0, maximum: candidates.length,
    candidateLabels: Object.fromEntries(candidates.map((target) => [target.uid, target.name])), label: "破壊処理を行う自分Obを任意選択", message: card.text,
    continuation: { type: "std163-destroy", playerId, sourceName: card.name } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return PASS;
}
