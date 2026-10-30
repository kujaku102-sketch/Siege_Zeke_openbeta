// STD-179 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { openNextQueuedSelection } from "../../game/core/projection.js";
import { placeCardByEffect, setCardSleeping } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_179.js)
export function std179PlaceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (result.scope !== "スリープしてドラッグする") { openNextQueuedSelection(state); return true; }
  const card = player.hand.find((item) => item.uid === continuation.sourceUid && item.id === "STD-179");
  if (!card) { openNextQueuedSelection(state); return true; }
  const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
  // ドラッグ(アクセスで取得したカードの効果配置)としてスリープ状態で置く。
  const placed = placeCardByEffect(state, {
    sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: card.uid, sourceName: continuation.sourceName,
    placementCause: "access_drag",
    onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
  }).status === "placed";
  if (placed) setCardSleeping(state, playerId, card);
  openNextQueuedSelection(state);
  return placed;
}
