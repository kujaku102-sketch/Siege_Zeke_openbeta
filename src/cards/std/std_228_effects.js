import { dealFortressDamage } from "../../game/core/deal-damage.js";
import { addLog, otherPlayer, payMemory } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { emitEffectPlacement, placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_228.js)
export function std228ActivateCardEffectCore({ playerId, state, player, effect, card }) {
  if (effect.kind === "update") {
    const opponentId = otherPlayer(playerId); const opponent = state.players[opponentId];
    const zones = ["front", "back"];
    payMemory(state, playerId, effect.cost, "update");
    dealFortressDamage(state, playerId, 3, playerId, card.name);
    const sourceZone = player.front.some((item) => item.uid === card.uid) ? "front" : "back";
    const sourceIndex = player[sourceZone].findIndex((item) => item.uid === card.uid);
    if (sourceIndex < 0) return false;
    const [moved] = player[sourceZone].splice(sourceIndex, 1);
    const zone = zones[Math.floor(state.rng() * zones.length)];
    if (placeByMode(state, opponentId, moved, { zone, from: sourceZone, source: card.name }) !== "placed") return true;
    emitEffectPlacement(state, opponentId, moved, zone, card.name);
    addLog(state, `${card.name}: 自分へ3ダメージ後、相手${zone}へ配置。`, "effect");
    return true;
  }
  return PASS;
}
