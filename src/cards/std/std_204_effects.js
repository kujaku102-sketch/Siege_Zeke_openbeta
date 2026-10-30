import { addLog, findCard } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { createVengeanceCard } from "../../game/effects/generic/generate.js";
import { placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_204.js)
export function std204ActivateScriptCore({ state, replacementTargetUid, playerId, script }) {
  if (replacementTargetUid) {
    const target = findCard(state, replacementTargetUid);
    if (target && ["front", "back"].includes(target.zoneName)) {
      const targetZone = state.players[target.playerId][target.zoneName];
      const targetIndex = targetZone.findIndex((card) => card.uid === replacementTargetUid);
      const [executedOb] = targetZone.splice(targetIndex, 1);
      executedOb.layerRole = "layered";
      const gigantes = createVengeanceCard(state, "STD-205", playerId);
      gigantes.mounted = [executedOb];
      gigantes.summoningSick = true;
      const zone = target.zoneName;
      if (placeByMode(state, playerId, gigantes, { zone, from: target.zoneName, source: script.name }) !== "placed") return true;
      addLog(state, `${script.name}: ${executedOb.name}の配置を置換し、「ドールズ・ギガンテス」のレイヤーとして配置。`, "effect");
    }
  }
  return PASS;
}
