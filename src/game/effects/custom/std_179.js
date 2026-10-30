import { openNextQueuedSelection } from "../../core/projection.js";
import { placeCardByEffect } from "../generic/placement.js";

export function std179PlaceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (result.scope !== "配置する") { openNextQueuedSelection(state); return true; }
  const card = player.hand.find((item) => item.uid === continuation.sourceUid && item.id === "STD-179");
  if (!card) { openNextQueuedSelection(state); return true; }
  const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
  const placed = placeCardByEffect(state, {
    sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: card.uid, sourceName: continuation.sourceName,
    onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
  }).status === "placed";
  openNextQueuedSelection(state);
  return placed;
}
