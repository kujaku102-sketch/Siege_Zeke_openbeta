import { createSelectionRequest } from "../../selection-model.js";
import { attack } from "../../core/battle.js";
import { addLog } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";
import { PASS } from "./index.js";

export function std214AttackCostSelection(state, continuation, result, playerId, player) {
  const index = player.registry.findIndex((item) => item.uid === result.selected[0]);
  const attacker = player.front.find((item) => item.uid === continuation.attackerUid && item.id === "STD-214");
  state.pending = null;
  if (index < 0 || !attacker) return false;
  const [recovered] = player.registry.splice(index, 1); player.hand.push(recovered);
  emitGameEvent(state, { type: "registry_left", playerId, ownerId: recovered.owner ?? playerId, cardUid: recovered.uid, cardId: recovered.id, cardName: recovered.name, category: recovered.category, reason: "attack-cost" });
  attacker.skipStd214AttackCost = true;
  return attack(state, playerId, attacker.uid, continuation.targetUid);
}

export function std214AttackCore3({ player, state, attacker, playerId, attackerUid, targetUid }) {
  if (!attacker.skipStd214AttackCost) {
    const candidates = player.registry.filter((card) => !card.faceDown);
    if (!candidates.length) { addLog(state, `${attacker.name}: レジストリから回収できず攻撃失敗。`, "effect"); return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${attacker.name}: 攻撃宣言時の回収`, message: attacker.text,
      continuation: { type: "std214-attack-cost", playerId, attackerUid, targetUid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return PASS;
}
