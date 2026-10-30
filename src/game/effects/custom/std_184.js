import { openNextQueuedSelection } from "../../core/projection.js";
import { addLog } from "../../core/shared.js";
import { emitEffectPlacement, placeByMode } from "../generic/placement.js";

export function std184PlaceObSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (result.scope !== "Obとして配置する") { openNextQueuedSelection(state); return true; }
  const index = player.back.findIndex((item) => item.uid === continuation.sourceUid && item.id === "STD-184" && item.std184Script && item.faceDown);
  if (index < 0) { openNextQueuedSelection(state); return true; }
  const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length - 1 < player.user.backLimit ? "back" : "front";
  const [card] = player.back.splice(index, 1);
  card.category = "Ob";
  delete card.std184Script;
  card.faceDown = false;
  card.residentActive = false;
  card.sleep = false;
  card.damage = 0;
  card.summoningSick = zone === "front";
  if (placeByMode(state, playerId, card, { zone, from: "back", source: continuation.sourceName }) !== "placed") { openNextQueuedSelection(state); return true; }
  emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
  addLog(state, `${continuation.sourceName}: Script状態からObとして${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
  openNextQueuedSelection(state);
  return true;
}
