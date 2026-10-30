// SZTB-095 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { finalizeDeferredSpellCleanup } from "../../game/core/play.js";

// handlers (was effects/custom/sztb_095.js)
export function sztb095SpReplacementSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  return finalizeDeferredSpellCleanup(state, { replacementHostUid: result.selected[0] ?? null });
}
