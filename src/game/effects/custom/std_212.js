import { addLog } from "../../core/shared.js";
import { completeTurnAfterDelayedEffects } from "../../core/turn.js";
import { createVengeanceCard, placeByMode } from "../generic/placement.js";

export function std212RespawnCountSelection(state, continuation, result, playerId, player) {
  const count = Math.min(continuation.maximum, Math.max(0, Number(result.scope) || 0));
  let generated = 0;
  for (let index = 0; index < count; index += 1) {
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const card = createVengeanceCard(state, "STD-189", playerId);
    card.summoningSick = zoneName === "front";
    if (placeByMode(state, playerId, card, { zone: zoneName, from: "generated", source: continuation.sourceName }) === "placed") generated += 1;
  }
  addLog(state, `${continuation.sourceName}: 破壊されたOb ${continuation.maximum}枚を参照し、「ドールズ」を${generated}枚生成。`, "effect");
  state.pending = null;
  return completeTurnAfterDelayedEffects(state, continuation.activeId);
}
