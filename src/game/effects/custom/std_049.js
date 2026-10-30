import { dealFortressDamage } from "../../core/battle.js";
import { addLog, otherPlayer } from "../../core/shared.js";
import { PASS } from "./index.js";
import { destroyCard, placeByMode } from "../generic/placement.js";

export function resolveStd049TurnEnd(state, activeId) {
  const controllerId = otherPlayer(activeId);
  const player = state.players[controllerId];
  const armed = player.trash.filter((card) => card.id === "STD-049" && card.std049ProxyArmed);
  if (!armed.length) return;
  const calamities = [...player.front, ...player.back].filter((card) => card.id === "STD-050");
  if (!calamities.length) return;
  let destroyed = 0;
  for (const target of calamities) {
    if (destroyCard(state, controllerId, target.uid, { source: "宵の明星の起動コスト" })) destroyed += 1;
  }
  if (!destroyed) return;
  for (const source of armed) {
    dealFortressDamage(state, activeId, 5, controllerId, source.name);
    const trashIndex = player.trash.findIndex((card) => card.uid === source.uid);
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    if (trashIndex >= 0) {
      const [decoded] = player.trash.splice(trashIndex, 1);
      delete decoded.std049ProxyArmed;
      decoded.sleep = false;
      decoded.summoningSick = false;
      decoded.damage = 0;
      const placed = placeByMode(state, controllerId, decoded, { zone: zoneName, from: "trash", source: source.name }) === "placed";
      if (!placed) continue;
      addLog(state, `${source.name}: 災いの明星${destroyed}体を破壊し、5ダメージとデコードを解決。`, "effect");
    }
  }
}

export function std049GetEffectActivationTargets({ state, playerId, effectId, card }) {
  if (effectId?.startsWith(`${card.id}:proxy:`)) {
    const opponent = state.players[otherPlayer(playerId)];
    return [...opponent.front, ...opponent.back];
  }
  return PASS;
}
