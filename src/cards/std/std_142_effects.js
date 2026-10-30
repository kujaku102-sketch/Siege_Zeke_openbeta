import { createSelectionRequest } from "../../game/selection-model.js";
import { activateScript } from "../../game/core/scripts.js";
import { addLog, fail, findCard } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";
import { placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_142.js)
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

export function activateStd142Effect1Selection(state, continuation, result, playerId, player) {
  state.pending = null;
  return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
}

export function std142TurnEndChoiceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (!result.selected.length) {
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  const source = findCard(state, continuation.sourceUid);
  if (!source || source.card.faceDown === true || source.card.id !== "STD-142") {
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  (state.std142DestructionContinuations ??= {})[source.card.uid] = {
    type: "source",
    playerId,
    activeId: continuation.activeId,
    sourceName: continuation.sourceName
  };
  destroyCard(state, source.playerId, source.card.uid, { source: `${source.card.name}の②起動コスト` });
  return true;
}

export function std142DestroySelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (!result.selected.length) return scheduleStd142TurnEndResume(state, continuation.activeId);
  state.std142DestroyBatch = {
    playerId,
    activeId: continuation.activeId,
    sourceName: continuation.sourceName,
    queue: [...result.selected],
    destroyedCount: 0
  };
  return continueStd142DestroyResolution(state);
}

export function std142SalvageSelection(state, continuation, result, playerId, player) {
  for (const uid of result.selected) {
    const index = player.trash.findIndex((card) => card.uid === uid);
    if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
  }
  state.pending = null;
  return scheduleStd142TurnEndResume(state, continuation.activeId);
}

export function std142ActivateScriptCore({ player, script, selectionUid, state, playerId }) {
  player.scriptUsage[`${script.uid}:effect1`] = true;
  const handIndex = player.hand.findIndex((card) => card.uid === selectionUid);
  const trashIndex = player.trash.findIndex((card) => card.uid === selectionUid);
  const [placed] = handIndex >= 0 ? player.hand.splice(handIndex, 1) : player.trash.splice(trashIndex, 1);
  const origin = handIndex >= 0 ? "hand" : "trash";
  if (placeByMode(state, playerId, placed, { zone: "back", from: origin, source: script.name, suppressScriptWindow: origin === "trash" }) === "placed") {
    placed.faceDown = true;
    placed.cannotActivateTurn = state.turnNumber;
    addLog(state, `${script.name}: 「${placed.name}」を配置。このターン起動不可。`, "effect");
  }
  return PASS;
}

export function std142ActivateScriptCore2({ player, script, state, selectionUid, playerId, uid }) {
  if (player.scriptUsage[`${script.uid}:effect1`]) return fail(state, "このターンは①を起動済み。", false);
  const candidates = [...player.hand, ...player.trash].filter((card) => card.category === "Script" && card.name.includes("聖樹"));
  if (!candidates.length) return fail(state, "手札またはゴミ箱に配置できる「聖樹」Scriptがない。", false);
  if (!selectionUid) {
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "配置する「聖樹」Scriptを選択", message: script.text,
      continuation: { type: "activate-std142-effect1", playerId, scriptUid: uid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (!candidates.some((card) => card.uid === selectionUid)) return fail(state, "配置する「聖樹」Scriptを選んで。", false);
  return PASS;
}
