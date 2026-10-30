import { placeCardByEffect } from "../generic/placement.js";

export function std157PlaceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const zone = player.front.length < player.user.frontLimit ? "front" : "back";
  // エリアが埋まっていて置けなかった時はルール破壊で処理済み。効果全体は巻き戻さない
  return ["placed", "failed-placement"].includes(placeCardByEffect(state, {
    sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: result.selected[0], sourceName: continuation.sourceName,
    onPlaced: (card) => { card.summoningSick = zone === "front"; }
  }).status);
}
