import { resultCountGate } from "../../effect-operation-library.js";
import { continueDeferredSpellCleanup } from "../../core/play.js";
import { addLog, classKey, findCard } from "../../core/shared.js";
import { drawCards } from "../../core/turn.js";
import { destroyCard } from "../generic/placement.js";

export function continueStd211DestructionBatch(state) {
  const batch = state.std211DestructionBatch;
  if (!batch || state.pending || state.prompt || state.deferredDestruction) return false;
  const player = state.players[batch.playerId];
  while (batch.queue.length) {
    const targetUid = batch.queue.shift();
    const target = findCard(state, targetUid);
    if (!target || target.playerId !== batch.playerId || !["front", "back"].includes(target.zoneName)
      || !(target.card.classes ?? []).some((value) => classKey(value) === classKey(batch.className))) continue;
    (state.std211DestructionContinuations ??= {})[targetUid] = true;
    destroyCard(state, batch.playerId, targetUid, { source: batch.sourceName, suppressReplacement: true });
    return true;
  }
  const resultGate = resultCountGate(batch.destroyedCount);
  if (resultGate.shouldResolveDependentBlock) {
    drawCards(state, batch.playerId, resultGate.count);
    addLog(state, `${batch.sourceName}: クラス「${batch.className}」を${resultGate.count}枚破壊し、${resultGate.count}枚ドロー。`, "effect");
  } else {
    addLog(state, `${batch.sourceName}: 破壊実績が0枚のため、後続のドロー処理を行わず終了。`, "effect");
  }
  delete state.std211DestructionBatch;
  return continueDeferredSpellCleanup(state);
}

export function settleStd211DestructionContinuation(state, targetUid, destroyed) {
  if (!state.std211DestructionContinuations?.[targetUid]) return false;
  delete state.std211DestructionContinuations[targetUid];
  if (!Object.keys(state.std211DestructionContinuations).length) delete state.std211DestructionContinuations;
  if (destroyed) state.std211DestructionBatch.destroyedCount += 1;
  return continueStd211DestructionBatch(state);
}
