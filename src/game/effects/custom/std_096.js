import { isObCard } from "../../card-types.js";
import { flattenedLayerCount, normalizeMountedStack } from "../../layered-specs.js";
import { createSelectionRequest, isSelectionRequestFeasible } from "../../selection-model.js";
import { continueAttackAfterCost } from "../../core/battle.js";
import { PASS } from "./index.js";

export function std096AttackCore({ attacker, player, playerId, target, state }) {
  if (flattenedLayerCount(attacker) >= (attacker.id === "STD-238" ? 2 : 1) && !attacker.skipQ3LayerAttackChoice) {
    normalizeMountedStack(attacker);
    if (attacker.id === "STD-102") {
      normalizeMountedStack(attacker);
      const hasFeasibleLayer = attacker.mounted.some((layer) => {
        const candidates = [...player.trash, ...(isObCard(layer) || layer.category === "Code" ? [layer] : [])]
          .filter((card, index, cards) => (isObCard(card) || card.category === "Code") && cards.findIndex((item) => item.uid === card.uid) === index);
        const feasibility = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
          exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])) });
        return isSelectionRequestFeasible(feasibility);
      });
      if (!hasFeasibleLayer) attacker.skipQ3LayerAttackChoice = true;
    }
    if (!attacker.skipQ3LayerAttackChoice) {
      const layerCost = attacker.id === "STD-238" ? 2 : 1;
      const request = createSelectionRequest({ mode: "scope", scopeField: "layerAttack", scopeOptions: ["起動しない", `レイヤー${layerCost}枚を破棄して起動`],
        label: `${attacker.name}の攻撃時効果`, message: attacker.text,
        continuation: { type: "q3-layer-attack-choice", playerId, sourceUid: attacker.uid, targetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  return PASS;
}

export function std096ResolveCardSelectionCore({ state, playerId, source, continuation }) {
  return continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid, { standbyAfter: true });
}
