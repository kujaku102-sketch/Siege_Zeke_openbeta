import { isObCard } from "../../card-types.js";
import { declareResponse } from "../../core/response.js";
import { findCard, otherPlayer } from "../../core/shared.js";

export function activateStd203Response(state, playerId, cardUid, selectedUids, responseEvent) {
  const own = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  const enemyId = otherPlayer(playerId);
  const enemy = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === enemyId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  if (!own || !enemy) return false;
  return declareResponse(state, playerId, cardUid, {
    targetUid: enemy.card.uid, targetUids: [own.card.uid, enemy.card.uid], responseEvent
  });
}
