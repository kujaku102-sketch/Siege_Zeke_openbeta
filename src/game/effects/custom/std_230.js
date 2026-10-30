import { attack } from "../../core/battle.js";
import { openNextQueuedSelection } from "../../core/projection.js";
import { emitGameEvent } from "../../core/triggers.js";
import { moveCardToTrash } from "../generic/placement.js";

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
