// STD-162 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { addLog } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";

// handlers (was effects/custom/std_162.js)
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
