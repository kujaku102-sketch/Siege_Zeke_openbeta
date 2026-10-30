import { CARD_LIBRARY } from "../../data/cards.js";
import { resultCountGate } from "../../game/effect-operation-library.js";
import { drawCards } from "../../game/core/draw.js";
import { continueDeferredSpellCleanup } from "../../game/core/play-spell.js";
import { addLog, classKey, fail, findCard } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";

// handlers (was effects/custom/std_211.js)
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

export function std211NormalSpellSelection() {
  return { candidates: [], minimum: 0, maximum: 0, groups: [], scopes:
    [...new Set(Object.values(CARD_LIBRARY).flatMap(item => item.classes ?? []))].sort() };
}

export function std211PlayCardCore4({ state, force, selectionScope }) {
  if (!selectionScope) {
    return fail(state, "破壊するクラスを指定して。", force);
  }
  return PASS;
}

export function std211ResolveSpell({ player, selectionScope, state, playerId, card }) {
  const targets = [...player.front, ...player.back].filter((target) => (target.classes ?? []).some((value) => classKey(value) === classKey(selectionScope)));
  state.std211DestructionBatch = { playerId, sourceName: card.name, className: selectionScope, queue: targets.map((target) => target.uid), destroyedCount: 0 };
  continueStd211DestructionBatch(state);
  return PASS;
}
