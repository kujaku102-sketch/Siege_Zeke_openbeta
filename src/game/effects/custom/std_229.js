import { playCard, playCardCore } from "../../core/play.js";

export function playStd229Selection(state, continuation, result, playerId, player) {
  state.pending = null;
  const resume = continuation.options?.requestedSlot != null ? playCardCore : playCard;
  return resume(state, playerId, continuation.sourceUid, { ...continuation.options, targetUids: result.selected });
}
