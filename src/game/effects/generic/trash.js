import { inheritBoardSlot } from "../../board-slots.js";
import { normalizeMountedStack } from "../../layered-specs.js";
import { resumeStd230AmbushCleanup } from "../../../cards/std/std_230_effects.js";
import { keywordValue } from "../../core/keywords.js";
import { resolveLogoutAfterAreaExit } from "../../core/play-spell.js";
import { openScriptActivationWindow } from "../../core/scripts.js";
import { addLog, otherPlayer } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";
import { executeCardRuntimeSpec } from "./actions.js";
import { finalizeRuleDestruction } from "./placement.js";

export function moveCardToTrash(state, ownerId, card, source = "移動", { suppressScriptWindow = false, fromArea = false, ruleDestruction = null } = {}) {
  const owner = state.players[ownerId];
  if (!suppressScriptWindow && !state.winner && owner.trashBanUntilTurn !== state.turnNumber) {
    const scriptOwnerId = otherPlayer(ownerId);
    const scriptOwner = state.players[scriptOwnerId];
    const script = scriptOwner.back.find((candidate) => candidate.id === "STD-003" && candidate.faceDown === true
      && scriptOwner.memory >= Number(candidate.cost ?? 0));
    if (script) {
      (state.deferredTrashMoves ??= []).push({ ownerId, card, source, fromArea, ruleDestruction });
      const alreadyQueued = state.prompt?.scriptUid === script.uid
        || state.scriptActivationQueue.some((entry) => entry.prompt?.scriptUid === script.uid);
      if (!alreadyQueued) openScriptActivationWindow(state, scriptOwnerId, script, {
          type: "card_would_move_to_trash", ownerId, playerId: ownerId,
          cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, source
        });
      return "deferred";
    }
  }
  if (owner.trashBanUntilTurn === state.turnNumber) {
    owner.ban.push(card);
    distributeLayeredFollowers(state, card, "ban", source);
    addLog(state, `${source}: ${card.name}のゴミ箱移動をBANへ置換。`, "effect");
    if (ruleDestruction) finalizeRuleDestruction(state, ownerId, card, { ...ruleDestruction, to: "ban" });
    return "ban";
  }
  // ゴミ箱は公開領域: 裏向きで設置されていたScriptも表向きにする(裏のままだと選択肢の名前と参照が消える)
  card.faceDown = false;
  owner.trash.push(card);
  distributeLayeredFollowers(state, card, "trash", source);
  if (fromArea) executeCardRuntimeSpec(state, "area_to_trash", ownerId, card);
  if (ruleDestruction) finalizeRuleDestruction(state, ownerId, card, { ...ruleDestruction, to: "trash" });
  return "trash";
}

export function resumeDeferredTrashMove(state) {
  if (state.prompt || !state.deferredTrashMoves?.length) return false;
  let resumed = false;
  while (!state.prompt && state.deferredTrashMoves.length) {
    const deferred = state.deferredTrashMoves.shift();
    moveCardToTrash(state, deferred.ownerId, deferred.card, deferred.source, {
      suppressScriptWindow: true,
      fromArea: deferred.fromArea,
      ruleDestruction: deferred.ruleDestruction
    });
    if (deferred.fromArea) resolveLogoutAfterAreaExit(state, deferred.ownerId, deferred.card);
    resumed = true;
  }
  if (resumed) resumeStd230AmbushCleanup(state);
  return resumed;
}

export function clearComponents(target) {
  target.grantedKeywords = [];
  target.timedModifiers = [];
  target.damageModifiers = [];
  target.permanentAtk = 0;
  target.permanentStr = 0;
  target.tempAtk = 0;
  target.tempStr = 0;
  target.protect = 0;
  target.backup = 0;
  target.load = 0;
  target.counters = {};
  target.turnCostModifier = 0;
  delete target.revealedExecutionCost;
}

// エリアを離れたカードは別のカードとして戻る: ダメージ・負荷・各種補正・付与能力・カウンターはエリア離脱で消える。
// 離脱時に直接消すと破壊直後のログアウト等が最後の情報を読めなくなるため、エリアへ入る時点で確定的に初期化する
// (ゴミ箱・手札などエリア外にいる間は戦闘状態を参照する処理がない)。
export function resetLeftAreaState(card) {
  clearComponents(card);
  card.damage = 0;
  card.battleStrBonus = 0;
  card.protect = Number((card.compiled ? keywordValue(card, "PROTECT") : null) ?? 0);
  card.keywordExpiries = {};
  delete card.backupUsedTurn;
  delete card.backupUsesThisTurn;
}

export function revealUnderlyingCard(zone, index, topCard, controllerId, zoneName) {
  const [baseCard, ...deeperLayers] = topCard.mounted.splice(0);
  if (!baseCard) return null;
  baseCard.mounted.push(...deeperLayers);
  inheritBoardSlot(baseCard, topCard, { controllerId, zoneName });
  zone.splice(index, 0, baseCard);
  return baseCard;
}

// Layered materials follow layer 1. A Code mounted by ordinary execution
// stays in its original square, even when the upper card leaves that area.
export function revealMountedCode(zone, index, topCard, controllerId, zoneName) {
  if (!Array.isArray(topCard.mounted) || !topCard.mounted.length) return null;
  normalizeMountedStack(topCard);
  const mountedCode = topCard.mounted.filter((layer) => layer.layerRole !== "layered");
  topCard.mounted = topCard.mounted.filter((layer) => layer.layerRole === "layered");
  if (!mountedCode.length) return null;
  return revealUnderlyingCard(zone, index, { ...topCard, mounted: mountedCode }, controllerId, zoneName);
}

export function distributeLayeredFollowers(state, topCard, destination, source) {
  if (!Array.isArray(topCard.mounted) || !topCard.mounted.length) return;
  normalizeMountedStack(topCard);
  const followers = topCard.mounted.filter((layer) => layer.layerRole === "layered");
  topCard.mounted = topCard.mounted.filter((layer) => layer.layerRole !== "layered");
  for (const layer of followers) {
    const zone = destination === "trash" && layer.temporaryLayer ? "ban" : destination;
    state.players[layer.owner ?? topCard.owner][zone].push(layer);
    addLog(state, `${source}: ${layer.name}もレイヤー1と同じ${zone === "trash" ? "ゴミ箱" : zone === "ban" ? "BAN" : zone === "hand" ? "手札" : "レジストリ"}へ移動。`, "effect");
  }
}

export function triggerMoved(state, playerId, card, sourceZone, targetZone) {
  addLog(state, `${card.name}が${sourceZone}から${targetZone}へ移動。`, "system");
  emitGameEvent(state, {
    type: "card_moved",
    playerId,
    ownerId: card.owner ?? playerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    from: sourceZone,
    to: targetZone
  });
}
