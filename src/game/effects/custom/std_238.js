import { continueAttackAfterCost } from "../../core/battle.js";

export function std238ResolveCardSelectionCore({ source, state, playerId, continuation }) {
  source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
  return continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid, { standbyAfter: true });
}
