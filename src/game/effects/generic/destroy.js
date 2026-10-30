import { normalizeZoneSlots } from "../../board-slots.js";
import { isObCard } from "../../card-types.js";
import { destructionPermissionSpecsFor } from "../../continuous-effect-specs.js";
import { createSelectionRequest } from "../../selection-model.js";
import { settleStd142DestructionContinuation } from "../../../cards/std/std_142_effects.js";
import { triggerStd165Threshold } from "../../../cards/std/std_165_effects.js";
import { settleStd211DestructionContinuation } from "../../../cards/std/std_211_effects.js";
import { consumeProtect } from "../../core/deal-damage.js";
import { resolveMandatoryStateChecks } from "../../core/effects.js";
import { continueDeferredSpellCleanup, resolveLogoutAfterAreaExit } from "../../core/play.js";
import { openScriptActivationWindow, queueScriptPrompt } from "../../core/scripts.js";
import { addLog, cardTraits, hasClass, otherPlayer } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";
import { executeRuntimeActions, resumeDestroyLkiFollowUp } from "./actions.js";
import { continuePlacementCostBatch, settlePlacementCostDestruction } from "./cost.js";
import { backupLimit, placeByMode, setCardSleeping } from "./placement.js";
import { runtimeSourceFromContinuation } from "./selection.js";
import { moveCardToTrash, revealMountedCode } from "./trash.js";

export function queueRuntimeDestructionContinuation(state, targetUid, continuation) {
  (state.runtimeDestructionContinuations ??= {})[targetUid] = continuation;
}

export function settleRuntimeDestructionContinuation(state, targetUid, destroyed) {
  const continuation = state.runtimeDestructionContinuations?.[targetUid];
  if (!continuation) return false;
  delete state.runtimeDestructionContinuations[targetUid];
  continuation.runtime.records[continuation.recordAs] = destroyed ? 1 : 0;
  return executeRuntimeActions(
    state,
    continuation.playerId,
    runtimeSourceFromContinuation(state, continuation),
    continuation.remainingActions,
    { runtime: continuation.runtime }
  );
}

export function settleDestructionContinuations(state, targetUid, destroyed) {
  const runtime = settleRuntimeDestructionContinuation(state, targetUid, destroyed);
  const sacredTree = settleStd142DestructionContinuation(state, targetUid, destroyed);
  const scrapPatchwork = settleStd211DestructionContinuation(state, targetUid, destroyed);
  const placementCost = settlePlacementCostDestruction(state, targetUid, destroyed);
  return runtime || sacredTree || scrapPatchwork || placementCost;
}

export function resumeDeferredDestruction(state) {
  if (state.prompt || !state.deferredDestruction) return false;
  const deferred = state.deferredDestruction;
  state.deferredDestruction = null;
  const resolved = destroyCard(state, deferred.ownerId, deferred.uid, { source: deferred.source, suppressReplacement: deferred.suppressReplacement, suppressTrashScriptWindow: true, piercing: Boolean(deferred.piercing) });
  continueDeferredSpellCleanup(state);
  return resolved;
}

export function triggerObDestroyedExtras(state, destroyedCard) {
  if (!isObCard(destroyedCard)) return;
  for (const [playerId, player] of Object.entries(state.players)) {
  }
}

// piercing: STR0以下の常時破壊判定用。[プロテクト]も[バックアップ]も貫通する(裁定済み)。破壊不可・STD-003の窓・STD-099は通常どおり。
export function destroyCard(state, ownerId, uid, { source = "破壊", suppressReplacement = false, replacementChoice = null, suppressTrashScriptWindow = false, piercing = false } = {}) {
  const player = state.players[ownerId];
  normalizeZoneSlots(player.front, { controllerId: ownerId, zoneName: "front", limit: player.user?.frontLimit });
  normalizeZoneSlots(player.back, { controllerId: ownerId, zoneName: "back", limit: player.user?.backLimit });
  let zoneName = "front";
  let index = player.front.findIndex((card) => card.uid === uid);
  if (index < 0) {
    zoneName = "back";
    index = player.back.findIndex((card) => card.uid === uid);
  }
  if (index < 0) return false;
  const zone = player[zoneName];
  const protectedCard = zone[index];
  if (destructionPermissionSpecsFor(protectedCard.id).some((spec) => spec.type === "forbid_destruction" && spec.target === "source"
    && (protectedCard.id !== "STD-159" || protectedCard.faceDown !== true))) {
    addLog(state, `${protectedCard.name}は破壊できない。`, "effect");
    settleDestructionContinuations(state, uid, false);
    continuePlacementCostBatch(state);
    return false;
  }
  if (!piercing && consumeProtect(state, protectedCard, `${source}による破壊`)) {
    settleDestructionContinuations(state, uid, false);
    resumeDestroyLkiFollowUp(state, uid);
    continuePlacementCostBatch(state);
    return false;
  }
  const maxBackupUsesBefore = backupLimit(protectedCard);
  const grantedBackupUsesBefore = Number(protectedCard.backup ?? 0);
  const backupUsesBefore = protectedCard.backupUsedTurn === state.turnNumber ? Number(protectedCard.backupUsesThisTurn ?? 0) : 0;
  const backupAvailable = !piercing && zoneName === "front" && (grantedBackupUsesBefore > 0 || maxBackupUsesBefore > backupUsesBefore) && player.back.length < player.user.backLimit;
  const std099 = player.hand.find((candidate) => candidate.id === "STD-099");
  const std099Materials = [...player.front, ...player.back].filter((candidate) => candidate.uid !== uid && hasClass(candidate, "レッドパンクス"));
  const std099Available = isObCard(protectedCard) && protectedCard.name.includes("変形合体レッパオー") && std099 && std099Materials.length > 0;
  if (!suppressReplacement && replacementChoice === null && std099Available) {
    const options = ["破壊をそのまま適用", ...(backupAvailable ? ["[バックアップ]で置換"] : []), "STD-099で置換ログイン"];
    const request = createSelectionRequest({ mode: "scope", scopeField: "destructionReplacement", scopeOptions: options,
      label: `${protectedCard.name}の破壊置換`, message: "適用する置換を1つ選択。",
      continuation: { type: "destruction-replacement-choice", playerId: ownerId, targetUid: uid, std099Uid: std099.uid, source, piercing } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (!suppressTrashScriptWindow && !backupAvailable) {
    const scriptOwnerId = otherPlayer(ownerId);
    const script = state.players[scriptOwnerId].back.find((candidate) => candidate.id === "STD-003" && candidate.faceDown && state.players[scriptOwnerId].memory >= Number(candidate.cost ?? 0));
    if (script) {
      state.deferredDestruction = { ownerId, uid, source, suppressReplacement, piercing };
      openScriptActivationWindow(state, scriptOwnerId, script, { type: "card_would_move_to_trash", ownerId, playerId: ownerId, cardUid: uid, category: protectedCard.category });
      return true;
    }
  }
  const [card] = zone.splice(index, 1);
  const revealed = revealMountedCode(zone, index, card, ownerId, zoneName);
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は場に残る。`, "effect");

  const maxBackupUses = backupLimit(card);
  const grantedBackupUses = Number(card.backup ?? 0);
  const backupUsesThisTurn = card.backupUsedTurn === state.turnNumber ? Number(card.backupUsesThisTurn ?? 0) : 0;
  if (!piercing && !suppressReplacement && zoneName === "front" && (replacementChoice === "backup" || (replacementChoice === null && (grantedBackupUses > 0 || maxBackupUses > backupUsesThisTurn))) && player.back.length < player.user.backLimit) {
    setCardSleeping(state, ownerId, card);
    card.damage = 0;
    if (grantedBackupUses > 0) card.backup = grantedBackupUses - 1;
    else {
      card.backupUsedTurn = state.turnNumber;
      card.backupUsesThisTurn = backupUsesThisTurn + 1;
    }
    placeByMode(state, ownerId, card, { zone: "back", mode: "normal", from: "front", source: "バックアップ" });
    addLog(state, `${card.name}は[バックアップ]でスリープしてバックへ移動。`, "effect");
    emitGameEvent(state, {
      type: "card_destroyed", playerId: ownerId, ownerId,
      cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
      traits: cardTraits(card), from: zoneName, to: "back", source, replaced: true
    });
    state.turnStats.destroyedCards += 1;
    if (isObCard(card)) state.turnStats.destroyedOb += 1;
    if (isObCard(card)) {
      queueScriptPrompt(state, ownerId, "自分Obが破壊された時");
      queueScriptPrompt(state, otherPlayer(ownerId), "相手Obが破壊された時");
    }
    triggerObDestroyedExtras(state, card);
    settleDestructionContinuations(state, card.uid, true);
    resumeDestroyLkiFollowUp(state, card.uid);
    triggerStd165Threshold(state);
    continuePlacementCostBatch(state);
    return true;
  }
  const trashOutcome = moveCardToTrash(state, ownerId, card, source, { suppressScriptWindow: suppressTrashScriptWindow, fromArea: true });
  addLog(state, `${source}: ${card.name}を破壊。`, "damage");
  state.turnStats.destroyedCards += 1;
  if (isObCard(card)) state.turnStats.destroyedOb += 1;
  if (card.category === "Script" && card.name.includes("聖樹")) state.turnStats.destroyedSacredTreeScripts += 1;
  emitGameEvent(state, {
    type: "card_destroyed",
    playerId: ownerId,
    ownerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    traits: cardTraits(card),
    from: zoneName,
    source
  });
  if (trashOutcome !== "deferred") resolveLogoutAfterAreaExit(state, ownerId, card);
  if (isObCard(card)) {
    queueScriptPrompt(state, ownerId, "自分Obが破壊された時");
    queueScriptPrompt(state, otherPlayer(ownerId), "相手Obが破壊された時");
  }
  triggerObDestroyedExtras(state, card);
  triggerStd165Threshold(state);
  settleDestructionContinuations(state, card.uid, true);
  if (!state.pending) resumeDestroyLkiFollowUp(state, card.uid);
  continuePlacementCostBatch(state);
  return true;
}

export function discardMountedCard(state, ownerId, hostUid, layerUid, source = "レイヤー除去") {
  const host = [...state.players[ownerId].front, ...state.players[ownerId].back].find((card) => card.uid === hostUid);
  if (!host) return false;
  const index = host.mounted.findIndex((card) => card.uid === layerUid);
  if (index < 0) return false;
  const [layer] = host.mounted.splice(index, 1);
  moveCardToTrash(state, layer.owner ?? ownerId, layer, source);
  addLog(state, `${source}: ${host.name}のレイヤー「${layer.name}」をゴミ箱へ。`, "effect");
  resolveMandatoryStateChecks(state);
  return true;
}
