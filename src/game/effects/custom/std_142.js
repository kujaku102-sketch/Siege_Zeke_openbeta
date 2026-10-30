import { createSelectionRequest } from "../../selection-model.js";
import { findCard } from "../../core/shared.js";
import { destroyCard } from "../generic/placement.js";

export function scheduleStd142TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function std142PublicSacredTreeTargets(state) {
  return Object.entries(state.players).flatMap(([ownerId, owner]) =>
    ["front", "back"].flatMap((zoneName) => owner[zoneName]
      .filter((card) => card.faceDown !== true && card.name.includes("聖樹"))
      .map((card) => ({ ownerId, zoneName, card })))
  );
}

function openStd142DestroySelection(state, continuation) {
  const candidates = std142PublicSacredTreeTargets(state);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map(({ card }) => card.uid),
    count: candidates.length,
    minimum: 0,
    maximum: candidates.length,
    candidateLabels: Object.fromEntries(candidates.map(({ ownerId, card }) => [card.uid, `${state.players[ownerId].name ?? ownerId}: ${card.name}`])),
    label: "破壊処理を行う表向きの「聖樹」カードを任意選択",
    message: continuation.sourceName,
    continuation: {
      type: "std142-destroy",
      playerId: continuation.playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function continueStd142DestroyResolution(state) {
  const batch = state.std142DestroyBatch;
  if (!batch) return false;
  const next = batch.queue.shift();
  if (next) {
    const location = findCard(state, next);
    if (!location || location.card.faceDown === true || !location.card.name.includes("聖樹")) {
      return continueStd142DestroyResolution(state);
    }
    (state.std142DestructionContinuations ??= {})[next] = { type: "target" };
    destroyCard(state, location.playerId, next, { source: batch.sourceName });
    return true;
  }
  const player = state.players[batch.playerId];
  const candidates = player.trash.filter((card) => card.category === "Script");
  const maximum = Math.min(batch.destroyedCount, candidates.length);
  const { activeId, playerId, sourceName } = batch;
  delete state.std142DestroyBatch;
  if (maximum <= 0) return scheduleStd142TurnEndResume(state, activeId);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum: 0,
    maximum,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `Scriptを${maximum}枚までサルベージ`,
    message: sourceName,
    continuation: { type: "std142-salvage", playerId, activeId, sourceName }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function settleStd142DestructionContinuation(state, uid, destroyed) {
  const continuation = state.std142DestructionContinuations?.[uid];
  if (!continuation) return false;
  delete state.std142DestructionContinuations[uid];
  if (!Object.keys(state.std142DestructionContinuations).length) delete state.std142DestructionContinuations;
  if (continuation.type === "source") {
    if (destroyed) return openStd142DestroySelection(state, continuation);
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "target" && state.std142DestroyBatch) {
    if (destroyed) state.std142DestroyBatch.destroyedCount += 1;
    return continueStd142DestroyResolution(state);
  }
  return false;
}
