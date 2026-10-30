import { isObCard } from "../../card-types.js";
import { addLog } from "../../core/shared.js";

export function std162SalvageSelection(state, continuation, result, playerId, player) {
  for (const uid of result.selected) {
    const index = player.trash.findIndex((card) => card.uid === uid && isObCard(card));
    if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
  }
  state.pending = null;
  addLog(state, `${continuation.sourceName}: Ob${result.selected.length}枚をサルベージ。`, "effect");
  return true;
}
