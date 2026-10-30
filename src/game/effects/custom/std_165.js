import { isObCard } from "../../card-types.js";
import { createSelectionRequest } from "../../selection-model.js";
import { drainIndependentEffects } from "../../core/effects.js";
import { findCard, hasClass, otherPlayer } from "../../core/shared.js";
import { destroyCard } from "../generic/placement.js";

export function beginStd165ThresholdEffect(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid);
  if (!source || source.playerId !== playerId || source.zoneName !== "back" || source.card.id !== "STD-165" || !source.card.residentActive) return false;
  const player = state.players[playerId];
  const candidates = [...player.hand, ...player.trash].filter((card) => isObCard(card) && hasClass(card, "旧支配者"));
  const sourceName = source.card.name;
  const sourceText = source.card.text;
  state.resolvingStd165 = true;
  const destroyed = destroyCard(state, playerId, sourceUid, { source: sourceName, suppressReplacement: true, suppressTrashScriptWindow: true });
  state.resolvingStd165 = false;
  if (!destroyed) return false;
  if (!candidates.length) return true;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${sourceName}: 旧支配者をログイン`, message: sourceText,
    continuation: { type: "std165-login", playerId, sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function triggerStd165Threshold(state) {
  if (state.resolvingStd165 || Number(state.turnStats.destroyedCards ?? 0) < 4) return;
  const ownerOrder = [state.active, otherPlayer(state.active)];
  const entriesByOwner = new Map();
  for (const playerId of ownerOrder) {
    const player = state.players[playerId];
    const entries = [];
    for (const source of player.back.filter((card) => card.id === "STD-165" && card.residentActive)) {
      entries.push({ kind: "STD-165", playerId, sourceUid: source.uid, sourceName: source.name });
    }
    entriesByOwner.set(playerId, entries);
  }
  let hasNext = true;
  while (hasNext) {
    hasNext = false;
    for (const playerId of ownerOrder) {
      const next = entriesByOwner.get(playerId)?.shift();
      if (!next) continue;
      (state.independentEffects ??= []).push(next);
      hasNext = true;
    }
  }
  if (!state.effectResolution && !state.pending && !state.prompt) drainIndependentEffects(state);
}
