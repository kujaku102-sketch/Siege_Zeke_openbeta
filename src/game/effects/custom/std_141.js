import { createSelectionRequest } from "../../selection-model.js";
import { findCard, otherPlayer } from "../../core/shared.js";

export function scheduleStd141TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function isStd141TurnEndSource(state, ownerId, uid) {
  const source = findCard(state, uid);
  return Boolean(source && source.playerId === ownerId && source.zoneName === "back"
    && source.card.id === "STD-141" && source.card.residentActive);
}

export function takeStd141TurnEndSource(state, ownerId, uid) {
  const queue = state.std141TurnEndQueue;
  if (!queue) return false;
  queue.entries[ownerId] = (queue.entries[ownerId] ?? []).filter((entryUid) => entryUid !== uid);
  queue.nextOwnerId = otherPlayer(ownerId);
  return isStd141TurnEndSource(state, ownerId, uid);
}

export function openStd141EffectChoice(state, ownerId, activeId, sourceUid) {
  const source = findCard(state, sourceUid);
  if (!source || source.playerId !== ownerId || source.card.id !== "STD-141" || !source.card.residentActive) {
    return scheduleStd141TurnEndResume(state, activeId);
  }
  const count = Number(state.turnStats.destroyedSacredTreeScripts ?? 0);
  if (count < 2) return scheduleStd141TurnEndResume(state, activeId);
  const options = count === 2 ? ["①2枚"] : ["②3枚以上"];
  if (count >= 5) options.push("③5枚以上");
  const request = createSelectionRequest({ mode: "scope", scopeField: "effect", scopeOptions: options,
    label: `${source.card.name}: 適用する効果`, message: `${count}枚の「聖樹」Scriptが破壊された。`,
    continuation: { type: "std141-choice", playerId: ownerId, sourceUid, sourceName: source.card.name, activeId } });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function continueStd141TurnEndQueue(state, activeId) {
  const queue = state.std141TurnEndQueue;
  if (!queue || queue.activeId !== activeId) return false;
  for (let attempts = 0; attempts < 2; attempts += 1) {
    const ownerId = queue.nextOwnerId;
    const candidates = (queue.entries[ownerId] ?? []).filter((uid) => isStd141TurnEndSource(state, ownerId, uid));
    queue.entries[ownerId] = candidates;
    if (!candidates.length) {
      queue.nextOwnerId = otherPlayer(ownerId);
      continue;
    }
    if (candidates.length === 1) {
      const sourceUid = candidates[0];
      takeStd141TurnEndSource(state, ownerId, sourceUid);
      return openStd141EffectChoice(state, ownerId, activeId, sourceUid);
    }
    const request = createSelectionRequest({ mode: "single", candidates, count: 1,
      candidateLabels: Object.fromEntries(candidates.map((uid) => [uid, findCard(state, uid)?.card.name ?? "聖樹枝束"])),
      label: "ターン終了時に処理する聖樹枝束を選択", message: "未処理の自分の効果から1つを選択。",
      continuation: { type: "std141-turn-end-source", playerId: ownerId, activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return false;
}
