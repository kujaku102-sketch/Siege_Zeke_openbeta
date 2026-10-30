import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { findCard, otherPlayer, shuffle } from "../../game/core/shared.js";
import { emitEffectPlacement, placeByMode } from "../../game/effects/generic/placement.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_141.js)
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

export function std141ChoiceSelection(state, continuation, result, playerId, player) {
  const choice = result.scope;
  if (choice === "③5枚以上") {
    const candidates = player.hand.filter((card) => isObCard(card) && card.color === "黄");
    if (!candidates.length) { state.pending = null; return scheduleStd141TurnEndResume(state, continuation.activeId); }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "配置する黄のOb", message: continuation.sourceName,
      continuation: { type: "std141-place-yellow-ob", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, activeId: continuation.activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const count = choice === "②3枚以上" ? 3 : 2;
  const candidates = player.deck.filter((card) => card.name.includes("聖樹"));
  if (candidates.length < count) { state.pending = null; return scheduleStd141TurnEndResume(state, continuation.activeId); }
  const request = createSelectionRequest({ mode: "exact", candidates: candidates.map((card) => card.uid), count,
    label: `アクセスする「聖樹」カード${count}枚`, message: continuation.sourceName,
    continuation: { type: "std141-access", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, count, installOne: count === 3, activeId: continuation.activeId } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std141TurnEndSourceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const sourceUid = result.selected[0];
  if (!sourceUid || !takeStd141TurnEndSource(state, playerId, sourceUid)) return scheduleStd141TurnEndResume(state, continuation.activeId);
  return openStd141EffectChoice(state, playerId, continuation.activeId, sourceUid);
}

export function std141AccessSelection(state, continuation, result, playerId, player) {
  const selected = result.selected.map((uid) => player.deck.find((card) => card.uid === uid)).filter(Boolean);
  player.deck = player.deck.filter((card) => !result.selected.includes(card.uid));
  player.deck = shuffle(player.deck, state.rng);
  const request = createSelectionRequest({ mode: "single", candidates: selected.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(selected.map((card) => [card.uid, card.name])), label: continuation.installOne ? "設置する1枚" : "手札に加える1枚", message: continuation.sourceName,
    continuation: { type: "std141-access-destination", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, selected, installOne: continuation.installOne, activeId: continuation.activeId } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std141AccessDestinationSelection(state, continuation, result, playerId, player) {
  const chosen = continuation.selected.find((card) => card.uid === result.selected[0]);
  if (!chosen) return false;
  const rest = continuation.selected.filter((card) => card.uid !== chosen.uid);
  if (continuation.installOne) {
    if (placeByMode(state, playerId, chosen, { zone: "back", from: "deck", source: continuation.sourceName }) === "placed") chosen.faceDown = true;
  } else player.hand.push(chosen);
  for (const remainder of rest) moveCardToTrash(state, playerId, remainder, continuation.sourceName ?? "残りのカード");
  state.pending = null;
  return scheduleStd141TurnEndResume(state, continuation.activeId);
}

export function std141PlaceYellowObSelection(state, continuation, result, playerId, player) {
  const index = player.hand.findIndex((card) => card.uid === result.selected[0] && isObCard(card) && card.color === "黄");
  if (index >= 0) {
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const [card] = player.hand.splice(index, 1); card.summoningSick = true;
    if (placeByMode(state, playerId, card, { zone, from: "hand", source: continuation.sourceName }) === "placed") emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
  }
  state.pending = null;
  return scheduleStd141TurnEndResume(state, continuation.activeId);
}
