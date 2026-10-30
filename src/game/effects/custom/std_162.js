import { isObCard } from "../../card-types.js";
import { createSelectionRequest } from "../../selection-model.js";
import { addLog } from "../../core/shared.js";
import { PASS } from "./index.js";

export function std162SalvageSelection(state, continuation, result, playerId, player) {
  for (const uid of result.selected) {
    const index = player.trash.findIndex((card) => card.uid === uid && isObCard(card));
    if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
  }
  state.pending = null;
  addLog(state, `${continuation.sourceName}: Ob${result.selected.length}枚をサルベージ。`, "effect");
  return true;
}

export function std162ResolveSpell({ player, card, playerId, state }) {
  const candidates = [...player.front, ...player.back].filter(isObCard);
  if (candidates.length) {
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
      label: "破壊する自分Ob", message: card.text,
      continuation: { type: "std162-destroy", playerId, sourceName: card.name } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  }
  return PASS;
}
