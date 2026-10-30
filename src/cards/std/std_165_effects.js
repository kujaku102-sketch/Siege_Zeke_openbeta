import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { drainIndependentEffects, runEffectEntry } from "../../game/core/effects.js";
import { playCard } from "../../game/core/play.js";
import { findCard, hasClass, otherPlayer } from "../../game/core/shared.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";

// handlers (was effects/custom/std_165.js)
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

export function std165LoginSelection(state, continuation, result, playerId, player) {
  const uid = result.selected[0];
  let index = player.hand.findIndex((card) => card.uid === uid && isObCard(card) && hasClass(card, "旧支配者"));
  if (index < 0) {
    index = player.trash.findIndex((card) => card.uid === uid && isObCard(card) && hasClass(card, "旧支配者"));
    if (index < 0) return false;
    player.hand.push(player.trash.splice(index, 1)[0]);
  }
  state.pending = null;
  const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
  return playCard(state, playerId, uid, { zone, free: true, force: true, ignoreColor: true, placementCause: "effect", placementSource: continuation.sourceName, placementMode: "forced-effect" });
}

export function std165DrainIndependentEffects({ state, next }) {
  runEffectEntry(state, next.kind, next.playerId, () => beginStd165ThresholdEffect(state, next.playerId, next.sourceUid));
}
