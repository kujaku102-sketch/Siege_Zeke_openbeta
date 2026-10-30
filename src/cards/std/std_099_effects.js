import { inheritBoardSlot } from "../../game/board-slots.js";
import { resolveLogin } from "../../game/core/play-spell.js";
import { addLog, findCard, hasClass } from "../../game/core/shared.js";
import { emitGameEvent } from "../../game/core/triggers.js";
import { resumeDestroyLkiFollowUp } from "../../game/effects/generic/actions.js";
import { continuePlacementCostBatch } from "../../game/effects/generic/cost.js";
import { settleDestructionContinuations } from "../../game/effects/generic/destroy.js";

// handlers (was effects/custom/std_099.js)
export function std099ReplacementMaterialsSelection(state, continuation, result, playerId, player) {
  const targetLocation = findCard(state, continuation.targetUid);
  const sourceIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
  if (!targetLocation || sourceIndex < 0 || result.selected.length < 1) return false;
  const [sourceCard] = player.hand.splice(sourceIndex, 1);
  const targetZone = player[targetLocation.zoneName];
  const [targetCard] = targetZone.splice(targetZone.findIndex((card) => card.uid === continuation.targetUid), 1);
  const materials = [];
  for (const uid of result.selected) {
    const location = findCard(state, uid);
    if (!location || location.playerId !== playerId || !["front", "back"].includes(location.zoneName) || !hasClass(location.card, "レッドパンクス")) continue;
    const materialZone = player[location.zoneName];
    materials.push(...materialZone.splice(materialZone.findIndex((card) => card.uid === uid), 1));
  }
  targetCard.layerRole = "layered";
  for (const material of materials) material.layerRole = "layered";
  sourceCard.mounted = [targetCard, ...materials];
  sourceCard.sleep = false;
  sourceCard.summoningSick = true;
  inheritBoardSlot(sourceCard, targetCard, { controllerId: playerId, zoneName: targetLocation.zoneName });
  player[targetLocation.zoneName].push(sourceCard);
  state.pending = null;
  emitGameEvent(state, { type: "card_destroyed", playerId, ownerId: playerId, cardUid: targetCard.uid, cardId: targetCard.id,
    cardName: targetCard.name, category: targetCard.category, from: targetLocation.zoneName, to: "layer", source: continuation.source, replaced: true });
  resolveLogin(state, playerId, sourceCard);
  addLog(state, `${sourceCard.name}: ${targetCard.name}の破壊を置換し、レイヤーとして無償ログイン。`, "effect");
  settleDestructionContinuations(state, targetCard.uid, true);
  resumeDestroyLkiFollowUp(state, targetCard.uid);
  continuePlacementCostBatch(state);
  return true;
}
