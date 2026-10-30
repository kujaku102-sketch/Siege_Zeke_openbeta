// STD-226 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { openNextQueuedSelection } from "../../game/core/projection.js";
import { findCard } from "../../game/core/shared.js";
import { setCardSleeping } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_226.js)
export function std226CompressSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (!result.selected.length) { openNextQueuedSelection(state); return true; }
  const source = [...player.front, ...player.back].find((item) => item.uid === continuation.sourceUid && item.id === "STD-226" && !item.sleep);
  const target = findCard(state, result.selected[0]);
  if (source && target?.zoneName === "registry") { setCardSleeping(state, playerId, source); target.card.faceDown = true; }
  openNextQueuedSelection(state);
  return true;
}
