import { createSelectionRequest } from "../../game/selection-model.js";
import { attack } from "../../game/core/battle.js";
import { openNextQueuedSelection } from "../../game/core/projection.js";
import { otherPlayer } from "../../game/core/shared.js";
import { emitGameEvent } from "../../game/core/triggers.js";
import { emitRegistryInstalled } from "../../game/effects/generic/placement.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_230.js)
export function resumeStd230AmbushCleanup(state) {
  const cleanup = state.std230AmbushCleanup;
  if (!cleanup || state.pending || state.prompt || state.deferredTrashMoves?.length) return false;
  const player = state.players[cleanup.playerId];
  if (!cleanup.sourceRemovalStarted) {
    cleanup.sourceRemovalStarted = true;
    const sourceIndex = player.registry.findIndex((card) => card.uid === cleanup.sourceUid && card.id === "STD-230");
    if (sourceIndex >= 0) {
      const [source] = player.registry.splice(sourceIndex, 1);
      emitGameEvent(state, { type: "registry_left", playerId: cleanup.playerId, ownerId: source.owner ?? cleanup.playerId,
        cardUid: source.uid, cardId: source.id, cardName: source.name, category: source.category, reason: "ambush" });
      const destination = moveCardToTrash(state, cleanup.playerId, source, "アンブッシュ");
      if (destination === "deferred") return true;
    }
    cleanup.sourceRemovalDone = true;
  }
  if (!cleanup.sourceRemovalDone) {
    const removed = [...player.trash, ...player.ban].some((card) => card.uid === cleanup.sourceUid);
    if (!removed) return false;
    cleanup.sourceRemovalDone = true;
  }
  if (state.selectionQueue?.length) {
    openNextQueuedSelection(state);
    return true;
  }
  state.std230AmbushCleanup = null;
  const attacker = state.players[cleanup.attackerPlayerId].front.find((card) => card.uid === cleanup.attackerUid);
  if (!attacker) return true;
  attacker.skipStd230Ambush = true;
  return attack(state, cleanup.attackerPlayerId, attacker.uid, cleanup.targetUid);
}

export function std230AmbushChoiceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const attacker = state.players[continuation.attackerPlayerId].front.find((item) => item.uid === continuation.attackerUid);
  if (!attacker) return false;
  if (result.scope !== "[アンブッシュ:3]を起動") { attacker.skipStd230Ambush = true; return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.targetUid); }
  const sourceIndex = player.registry.findIndex((item) => item.uid === continuation.sourceUid && item.id === "STD-230" && !item.faceDown);
  const source = sourceIndex >= 0 ? player.registry[sourceIndex] : null;
  const cost = Number(source?.cost ?? 0);
  if (!source || player.memory < cost || player.registry.length < cost) {
    attacker.skipStd230Ambush = true;
    return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.targetUid);
  }
  player.memory -= cost;
  const opponentId = otherPlayer(playerId); const candidates = state.players[opponentId].hand;
  const cleanup = { playerId, sourceUid: source.uid, attackerPlayerId: continuation.attackerPlayerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
  if (!candidates.length) { state.std230AmbushCleanup = cleanup; return resumeStd230AmbushCleanup(state); }
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "相手手札からレジストリへ加える1枚", message: continuation.sourceName,
    continuation: { type: "std230-install-hand", playerId, opponentId, cleanup } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std230InstallHandSelection(state, continuation, result, playerId, player) {
  const opponent = state.players[continuation.opponentId];
  const chosenIndex = opponent.hand.findIndex((item) => item.uid === result.selected[0]);
  if (chosenIndex >= 0) { const [chosen] = opponent.hand.splice(chosenIndex, 1); player.registry.push(chosen); emitRegistryInstalled(state, playerId, chosen, "悪の発明"); }
  if (opponent.hand.length) { const randomIndex = Math.floor(state.rng() * opponent.hand.length); const [random] = opponent.hand.splice(randomIndex, 1); player.registry.push(random); emitRegistryInstalled(state, playerId, random, "悪の発明"); }
  state.pending = null;
  state.std230AmbushCleanup = continuation.cleanup;
  return resumeStd230AmbushCleanup(state);
}
