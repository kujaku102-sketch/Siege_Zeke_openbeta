import { openNextQueuedSelection } from "../../core/projection.js";
import { findCard } from "../../core/shared.js";
import { setCardSleeping } from "../generic/placement.js";

export function std226CompressSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (!result.selected.length) { openNextQueuedSelection(state); return true; }
  const source = [...player.front, ...player.back].find((item) => item.uid === continuation.sourceUid && item.id === "STD-226" && !item.sleep);
  const target = findCard(state, result.selected[0]);
  if (source && target?.zoneName === "registry") { setCardSleeping(state, playerId, source); target.card.faceDown = true; }
  openNextQueuedSelection(state);
  return true;
}
