import { attack } from "../../core/battle.js";
import { emitGameEvent } from "../../core/triggers.js";

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
