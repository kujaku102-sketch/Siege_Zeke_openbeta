import { finalizeDeferredSpellCleanup } from "../../core/play.js";

export function sztb095SpReplacementSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  return finalizeDeferredSpellCleanup(state, { replacementHostUid: result.selected[0] ?? null });
}
