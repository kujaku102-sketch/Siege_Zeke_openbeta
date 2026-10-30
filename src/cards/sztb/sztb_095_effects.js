import { finalizeDeferredSpellCleanup } from "../../game/core/play-spell.js";

// handlers (was effects/custom/sztb_095.js)
export function sztb095SpReplacementSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  return finalizeDeferredSpellCleanup(state, { replacementHostUid: result.selected[0] ?? null });
}
