import { findCard } from "../../core/shared.js";
import { resumeDestroyLkiFollowUp } from "../generic/actions.js";
import { destroyCard } from "../generic/placement.js";

export function std157DestroySelection(state, continuation, result, playerId, player) {
  const location = findCard(state, result.selected[0]);
  if (!location || location.playerId !== playerId) return false;
  const target = location.card;
  const x = continuation.type === "std157-destroy" ? Number(target.cost ?? 0) : Number(target.str ?? 0);
  (state.destroyLkiFollowUps ??= {})[target.uid] = { type: continuation.type === "std157-destroy" ? "std157" : "std162", playerId, sourceName: continuation.sourceName, x };
  state.pending = null;
  const resolved = destroyCard(state, playerId, target.uid, { source: continuation.sourceName });
  if (!state.pending) resumeDestroyLkiFollowUp(state, target.uid);
  return resolved;
}
