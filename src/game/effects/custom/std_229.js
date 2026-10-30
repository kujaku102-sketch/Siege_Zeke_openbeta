import { createSelectionRequest } from "../../selection-model.js";
import { playCard, playCardCore } from "../../core/play.js";
import { addLog, fail, shuffle } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";
import { PASS } from "./index.js";

export function playStd229Selection(state, continuation, result, playerId, player) {
  state.pending = null;
  const resume = continuation.options?.requestedSlot != null ? playCardCore : playCard;
  return resume(state, playerId, continuation.sourceUid, { ...continuation.options, targetUids: result.selected });
}

export function std229PlayCardCore({ player, state, force, card, playerId, free, ignoreColor, zone, requestedSlot, targetUids }) {
  if (targetUids.length !== 5) {
    if (player.registry.length < 5) return fail(state, "レジストリに戻せるカードが5枚ない。", force);
    const request = createSelectionRequest({ mode: "exact", candidates: player.registry.map((item) => item.uid), count: 5,
      candidateLabels: Object.fromEntries(player.registry.map((item) => [item.uid, item.name])), label: `${card.name}: 山札へ戻す5枚`, message: card.text,
      continuation: { type: "play-std229", playerId, sourceUid: card.uid, options: { free, ignoreColor, force, zone, requestedSlot } } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return PASS;
}

export function std229ResolveSpell({ targetUids, player, state, playerId, card }) {
  const selected = targetUids.map((uid) => player.registry.find((item) => item.uid === uid)).filter(Boolean);
  if (selected.length !== 5 || new Set(selected.map((item) => item.uid)).size !== 5) return;
  for (const item of selected) {
    const registryIndex = player.registry.findIndex((candidate) => candidate.uid === item.uid);
    player.deck.push(...player.registry.splice(registryIndex, 1));
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: item.owner ?? playerId, cardUid: item.uid, cardId: item.id, cardName: item.name, category: item.category, reason: "world-conquest" });
  }
  shuffle(player.deck, state.rng);
  state.extraTurnPlayerId = playerId;
  state.extraTurnDamagePenalty = 2;
  addLog(state, `${card.name}: レジストリ5枚を山札へ戻し、追加ターンを予約。`, "effect");
  return PASS;
}
