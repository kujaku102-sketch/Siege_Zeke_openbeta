// STD-179 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { openNextQueuedSelection } from "../../game/core/projection.js";
import { addLog } from "../../game/core/shared.js";
import { effectPlacementRoom, placeCardByEffect, setCardSleeping } from "../../game/effects/generic/placement.js";

// A Script that resolves queues one window for every STD-179 in the hand on one look at the room (core/scripts.js, core/effects.js), but each placement takes
// a slot. A window is for an effect the user may use, so one whose room has gone is not offered: it is dropped before the next one opens.
function openNextWindow(state, playerId) {
  if (!effectPlacementRoom(state, playerId)) {
    state.selectionQueue = state.selectionQueue.filter((entry) => {
      const continuation = entry.payload?.request?.continuation;
      return !(continuation?.type === "std179-place" && continuation.playerId === playerId);
    });
  }
  openNextQueuedSelection(state);
}

// handlers (was effects/custom/std_179.js)
export function std179PlaceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (result.scope !== "スリープしてドラッグする") { openNextWindow(state, playerId); return true; }
  const card = player.hand.find((item) => item.uid === continuation.sourceUid && item.id === "STD-179");
  if (!card) { openNextWindow(state, playerId); return true; }
  // A window that was already open when the room went (another effect took the slot) ends as "not placed" instead of an answer the engine cannot carry out.
  if (!effectPlacementRoom(state, playerId)) {
    addLog(state, `${continuation.sourceName}: 配置できる空きがないためドラッグしない。`, "effect");
    openNextWindow(state, playerId);
    return true;
  }
  const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
  // ドラッグ(アクセスで取得したカードの効果配置)としてスリープ状態で置く。
  const placed = placeCardByEffect(state, {
    sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: card.uid, sourceName: continuation.sourceName,
    placementCause: "access_drag",
    onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
  }).status === "placed";
  if (placed) setCardSleeping(state, playerId, card);
  openNextWindow(state, playerId);
  return placed;
}
