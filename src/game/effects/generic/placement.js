import { hasKeyword, keywordValue } from "../../../../packages/effect-compiler/index.js";
import { inheritBoardSlot, normalizeZoneSlots, placeCardInBoardSlot } from "../../board-slots.js";
import { isObCard } from "../../card-types.js";
import { destructionPermissionSpecsFor, mountEventSpecsFor } from "../../continuous-effect-specs.js";
import { normalizeMountedStack } from "../../layered-specs.js";
import { evaluatePlacement } from "../../placement-policy.js";
import { createRuntimeCard } from "../../runtime/factory.js";
import { createSelectionRequest } from "../../selection-model.js";
import { settleStd048MandatoryPlacement } from "../../../cards/std/std_048_effects.js";
import { settleStd142DestructionContinuation } from "../../../cards/std/std_142_effects.js";
import { triggerStd165Threshold } from "../../../cards/std/std_165_effects.js";
import { settleStd211DestructionContinuation } from "../../../cards/std/std_211_effects.js";
import { resumeStd230AmbushCleanup } from "../../../cards/std/std_230_effects.js";
import { consumeProtect, dealFortressDamage } from "../../core/deal-damage.js";
import { drawCards } from "../../core/draw.js";
import { resolveEffect, resolveMandatoryStateChecks, runEffectEntry } from "../../core/effects.js";
import { continueDeferredSpellCleanup, notifyCardExecuted, resolveLogin, resolveLogoutAfterAreaExit } from "../../core/play.js";
import { enqueueSelection, selectionProjectionMeta } from "../../core/projection.js";
import { openScriptActivationWindow, queueScriptPrompt } from "../../core/scripts.js";
import { hydrateCard } from "../../core/setup.js";
import { addLog, cardTraits, fail, findCard, hasClass, otherPlayer } from "../../core/shared.js";
import { emitGameEvent, emitUserAbilityFeedback, resumeTriggerThreadAfterSelection } from "../../core/triggers.js";
import { executeCardRuntimeSpec, executeRuntimeActions, resumeDestroyLkiFollowUp } from "./actions.js";
import { continuePlacementCostBatch, settlePlacementCostDestruction } from "./cost.js";
import { runtimeSourceFromContinuation } from "./selection.js";

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
function resetLeftAreaState(card) {
  clearComponents(card);
  card.damage = 0;
  card.battleStrBonus = 0;
  card.protect = Number((card.compiled ? keywordValue(card, "PROTECT") : null) ?? 0);
  card.keywordExpiries = {};
  delete card.backupUsedTurn;
  delete card.backupUsesThisTurn;
}

const backupLimit = (card) => {
  const match = String(card?.text ?? "").match(/\[バックアップ(?:[:：](\d+))?\]/);
  return match ? Number(match[1] ?? 1) : 0;
};

export function resolveMountedSourceTrigger(state, playerId, host, source) {
  const specs = source ? mountEventSpecsFor(source.id).filter((spec) => spec.event === "ob_mounted_on_source") : [];
  if (!specs.length) return false;
  const layerIndex = host.mounted.findIndex((card) => card.uid === source.uid);
  if (layerIndex < 0) return false;
  for (const spec of specs) for (const action of spec.actions) {
    if (action.type === "grant_backup" && action.target === "mounted_host") host.backup = Number(host.backup ?? 0) + Number(action.amount ?? 0);
    else if (action.type === "grant_protect" && action.target === "mounted_host") host.protect = Number(host.protect ?? 0) + Number(action.amount ?? 0);
    else if (action.type === "modify_stats" && action.target === "mounted_host") {
      host.permanentAtk = Number(host.permanentAtk ?? 0) + Number(action.atk ?? 0);
      host.permanentStr = Number(host.permanentStr ?? 0) + Number(action.str ?? 0);
    } else if (action.type === "draw" && action.target === "source_controller") drawCards(state, playerId, Number(action.amount ?? 0));
    else if (action.type === "destroy" && action.target === "source_layer") {
      const currentIndex = host.mounted.findIndex((card) => card.uid === source.uid);
      if (currentIndex < 0) continue;
      host.mounted.splice(currentIndex, 1);
      moveCardToTrash(state, source.owner ?? playerId, source, `${source.name}のマウント誘発`);
      state.turnStats.destroyedCards += 1;
      addLog(state, `${source.name}のマウント誘発: ${source.name}を破壊。`, "damage");
      emitGameEvent(state, {
        type: "card_destroyed", playerId, ownerId: source.owner ?? playerId,
        cardUid: source.uid, cardId: source.id, cardName: source.name,
        category: source.category, from: "layer", source: `${source.name}のマウント誘発`
      });
    } else throw new Error(`Unsupported mount event action: ${action.type}`);
  }
  addLog(state, `${source.name}: ${host.name}へマウント誘発を適用。`, "effect");
  return true;
}

export function queueRuntimeDestructionContinuation(state, targetUid, continuation) {
  (state.runtimeDestructionContinuations ??= {})[targetUid] = continuation;
}

function settleRuntimeDestructionContinuation(state, targetUid, destroyed) {
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

function triggerMountedSleepEffects(state, playerId, card) {
  for (const source of card.mounted ?? []) for (const spec of mountEventSpecsFor(source.id).filter((item) => item.event === "mounted_host_slept")) {
    const ownerId = source.owner ?? playerId;
    const owner = state.players[ownerId];
    for (const action of spec.actions) {
      if (action.type === "discard" && action.target === "source_owner_hand") {
        if (!owner?.hand.length) continue;
        const count = Math.min(Number(action.count ?? 1), owner.hand.length);
        const request = createSelectionRequest({ mode: count === 1 ? "single" : "exact", candidates: owner.hand.map((item) => item.uid), count,
          candidateLabels: Object.fromEntries(owner.hand.map((item) => [item.uid, item.name])), label: `${source.name}: 手札を${count}枚捨てる`, message: source.text,
          continuation: { type: "mounted-event-discard", playerId: ownerId, sourceName: source.name, count } });
        enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:mounted-event-discard", ownerId));
      } else if (action.type === "deal_damage" && action.target === "source_owner_user") {
        dealFortressDamage(state, ownerId, Number(action.amount ?? 0), ownerId, source.name);
      } else throw new Error(`Unsupported mounted host event action: ${action.type}`);
    }
  }
}

export function setCardSleeping(state, playerId, card) {
  if (card.sleep) return false;
  card.sleep = true;
  triggerMountedSleepEffects(state, playerId, card);
  return true;
}

export function emitEffectPlacement(state, playerId, card, zone, source) {
  return emitGameEvent(state, {
    type: "card_effect_placed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    color: card.color, traits: cardTraits(card), to: zone, placementCause: "effect", source
  });
}

export function emitCardsGenerated(state, playerId, cards, source) {
  if (!cards.length) return null;
  const event = emitGameEvent(state, {
    type: "card_generated", playerId, ownerId: playerId,
    cardUid: cards[0].uid, cardUids: cards.map((card) => card.uid), amount: cards.length, source
  });
  for (const controllerId of ["player", "ai"]) {
    const scripts = state.players[controllerId].back.filter((card) => card.id === "STD-038" && card.faceDown === true
      && state.players[controllerId].memory >= Number(card.cost ?? 0));
    for (const script of scripts) openScriptActivationWindow(state, controllerId, script, event);
  }
  return event;
}

export function banGeneratedCards(state, uids, source) {
  let moved = 0;
  for (const playerId of ["player", "ai"]) {
    const player = state.players[playerId];
    for (const uid of uids) {
      for (const zoneName of ["hand", "front", "back", "registry", "trash", "deck"]) {
        const index = player[zoneName].findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        const [card] = player[zoneName].splice(index, 1);
        if (["front", "back"].includes(zoneName)) revealMountedCode(player[zoneName], index, card, playerId, zoneName);
        player.ban.push(card);
        if (["front", "back"].includes(zoneName)) distributeLayeredFollowers(state, card, "ban", source);
        moved += 1;
        break;
      }
    }
  }
  addLog(state, `${source}: 生成されたカード${moved}枚をBAN。`, "effect");
  return moved;
}

export function emitCardPlacement(state, playerId, card, zone, placementCause, source = null) {
  return emitGameEvent(state, { type: "card_placed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    color: card.color, traits: cardTraits(card), to: zone, placementCause, source });
}

function finalizeRuleDestruction(state, ownerId, card, { from = "hand", to = "trash", source = "配置上限", zone = null } = {}) {
  state.turnStats.destroyedCards += 1;
  if (isObCard(card)) state.turnStats.destroyedOb += 1;
  if (card.category === "Script" && card.name.includes("聖樹")) state.turnStats.destroyedSacredTreeScripts += 1;
  emitGameEvent(state, {
    type: "card_destroyed", playerId: ownerId, ownerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    from, to, zone, source, ruleDestruction: true
  });
  return true;
}

export function placementResult(player, zone, { addedSlots = 1, freedSlots = 0, mode = "normal" } = {}) {
  return evaluatePlacement({
    zone,
    occupied: player[zone]?.length ?? 0,
    limit: player.user?.[`${zone}Limit`],
    addedSlots,
    freedSlots,
    mode
  });
}

export function failForcedPlacement(state, ownerId, card, { from = "hand", zone, source = "効果による強制配置", suppressScriptWindow = false } = {}) {
  const owner = state.players[ownerId];
  if (from === "trash") {
    if (!owner.trash.some((item) => item.uid === card.uid)) owner.trash.push(card);
    finalizeRuleDestruction(state, ownerId, card, { from, to: "trash", zone, source });
  } else {
    moveCardToTrash(state, ownerId, card, source, {
      fromArea: false, suppressScriptWindow,
      ruleDestruction: { from, zone, source }
    });
  }
  addLog(state, `${source}: ${card.name}は配置上限によりエリアへ入らずルール破壊。`, "effect");
  return "failed-forced";
}

export function placeByMode(state, ownerId, card, { zone, mode = "forced-effect", from = "generated", source = "効果による強制配置", addedSlots = 1, freedSlots = 0, suppressScriptWindow = false, requestedSlot = null } = {}) {
  const player = state.players[ownerId];
  const placement = placementResult(player, zone, { addedSlots, freedSlots, mode });
  if (!placement.ok) {
    if (placement.mode === "forced-effect") return failForcedPlacement(state, card.owner ?? ownerId, card, { from, zone, source, suppressScriptWindow });
    return "normal-rejected";
  }
  const placed = placeCardInBoardSlot(player[zone], card, {
    controllerId: ownerId, zoneName: zone, limit: player.user?.[`${zone}Limit`], requestedSlot
  });
  if (!placed) {
    if (placement.mode === "forced-effect") return failForcedPlacement(state, card.owner ?? ownerId, card, { from, zone, source, suppressScriptWindow });
    return "normal-rejected";
  }
  if (!["front", "back"].includes(from)) {
    markFieldEntry(state, card);
    // 生成されたカードは効果が作った値をそのまま使う。実在のカードがエリア外から入る場合だけ初期化する。
    if (from !== "generated") resetLeftAreaState(card);
  }
  return "placed";
}

// Field entry table: the turn each card on the field arrived there. Moving
// between front and back keeps the entry; leaving the field drops it.
export function markFieldEntry(state, card) {
  if (!card?.uid) return;
  if (!state.fieldEntryTurns) state.fieldEntryTurns = {};
  state.fieldEntryTurns[card.uid] = state.turnNumber;
}

export function syncFieldEntryTurns(state) {
  const onField = new Set();
  const visit = (card) => {
    if (!card?.uid || onField.has(card.uid)) return;
    onField.add(card.uid);
    for (const layer of card.mounted ?? []) visit(layer);
  };
  for (const player of Object.values(state.players)) for (const card of [...player.front, ...player.back]) visit(card);
  const table = state.fieldEntryTurns ?? {};
  const next = {};
  for (const uid of onField) next[uid] = Object.hasOwn(table, uid) ? table[uid] : state.turnNumber;
  state.fieldEntryTurns = next;
}

function enteredFieldThisTurn(state, card) {
  syncFieldEntryTurns(state);
  return state.fieldEntryTurns[card.uid] === state.turnNumber;
}

// Summoning sickness after a front/back move: only a card that entered the
// field this turn (or is already sick) cannot attack from the front.
export function movedSummoningSick(state, card, targetZone) {
  return targetZone === "front" && !hasKeyword(card, "QA") && (Boolean(card.summoningSick) || enteredFieldThisTurn(state, card));
}

export function emitRegistryInstalled(state, playerId, card, source = "インストール") {
  card.faceDown = false;
  const event = emitGameEvent(state, { type: "registry_installed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, source });
  const installer = state.players[playerId];
  if (installer.user.abilityKey === "registry_liberty" && !installer.firstRegistryInstallResolved) {
    installer.firstRegistryInstallResolved = true;
    const drawn = drawCards(state, playerId, 1);
    installer.registryActionUsed = false;
    addLog(state, `${installer.user.abilityName}: 1枚引き、追加のインストール権を得た。`, "effect");
    emitUserAbilityFeedback(state, "registry_liberty", playerId, playerId, {
      branch: "first-install", amount: drawn, outcome: "install-ready", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId, zone: "deck" }, to: { kind: "zone_count", playerId, zone: "hand" }, count: drawn }, { kind: "state_change", target: { kind: "status", playerId, status: "extra_install" }, before: false, after: true }]
    });
  }
  const opponentId = otherPlayer(playerId);
  for (const observer of [...state.players[opponentId].front, ...state.players[opponentId].back].filter((item) => item.id === "STD-226" && !item.sleep && !item.faceDown)) {
    const candidates = [...state.players.player.registry, ...state.players.ai.registry].filter((item) => !item.faceDown);
    if (!candidates.length) continue;
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), minimum: 0, maximum: 1,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: `${observer.name}: レジストリを裏向き`, message: observer.text,
      continuation: { type: "std226-compress", playerId: opponentId, sourceUid: observer.uid, sourceName: observer.name } });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:std226-compress", opponentId));
  }
  return event;
}

export function resumeDeferredDestruction(state) {
  if (state.prompt || !state.deferredDestruction) return false;
  const deferred = state.deferredDestruction;
  state.deferredDestruction = null;
  const resolved = destroyCard(state, deferred.ownerId, deferred.uid, { source: deferred.source, suppressReplacement: deferred.suppressReplacement, suppressTrashScriptWindow: true, piercing: Boolean(deferred.piercing) });
  continueDeferredSpellCleanup(state);
  return resolved;
}

export function forceExecuteCard(state, { sourceOwnerId, controllerId, cardUid, sourceZone, targetZone, sourceName = "強制実行", onPlaced = null } = {}) {
  const sourcePlayer = state.players[sourceOwnerId];
  const controller = state.players[controllerId];
  const sourceCards = sourcePlayer?.[sourceZone];
  if (!Array.isArray(sourceCards) || !controller || !["area", "front", "back"].includes(targetZone)) return { status: "invalid" };
  const sourceIndex = sourceCards.findIndex((card) => card.uid === cardUid);
  if (sourceIndex < 0) return { status: "missing" };
  const [sourceCard] = sourceCards.splice(sourceIndex, 1);
  const card = hydrateCard(sourceCard);
  const zoneName = targetZone === "area"
    ? (controller.front.length < controller.user.frontLimit ? "front" : controller.back.length < controller.user.backLimit ? "back" : "front")
    : targetZone;
  if (placeByMode(state, controllerId, card, { zone: zoneName, from: sourceZone, source: sourceName, mode: "forced-effect" }) !== "placed") return { status: "failed-placement", card };
  onPlaced?.(card, zoneName);
  resolveEffect(state, () => resolveLogin(state, controllerId, card));
  notifyCardExecuted(state, controllerId, card);
  emitCardPlacement(state, controllerId, card, zoneName, "effect", sourceName);
  return { status: "placed", card, zoneName };
}

export function placeCardByEffect(state, { sourceOwnerId, controllerId, cardUid, sourceZone, targetZone, sourceName = "効果配置", placementMode = "forced-effect", placementCause = "effect", underUid = null, onPlaced = null } = {}) {
  const sourcePlayer = state.players[sourceOwnerId];
  const controller = state.players[controllerId];
  const sourceCards = sourcePlayer?.[sourceZone];
  const targetCards = controller?.[targetZone];
  if (!Array.isArray(sourceCards) || !Array.isArray(targetCards) || !["front", "back"].includes(targetZone)) return { status: "invalid" };
  const sourceIndex = sourceCards.findIndex((card) => card.uid === cardUid);
  if (sourceIndex < 0) return { status: "missing" };
  const host = underUid ? targetCards.find((card) => card.uid === underUid && isObCard(card)) : null;
  const sourceCard = sourceCards[sourceIndex];
  if (underUid && (!host || sourceCard.category !== "Code")) return { status: "invalid" };
  const [removed] = sourceCards.splice(sourceIndex, 1);
  const card = removed;
  if (host) {
    card.layerRole = "code";
    host.mounted.push(card);
    onPlaced?.(card, targetZone);
    emitCardPlacement(state, controllerId, card, targetZone, placementCause, sourceName);
    if (placementCause !== "access_drag") emitEffectPlacement(state, controllerId, card, targetZone, sourceName);
    return { status: "placed", card, zoneName: targetZone };
  }
  const placement = placeByMode(state, controllerId, card, { zone: targetZone, from: sourceZone, source: sourceName, mode: placementMode });
  if (placement !== "placed") {
    if (placement === "normal-rejected") sourceCards.splice(sourceIndex, 0, removed);
    return { status: placement === "normal-rejected" ? "rejected" : "failed-placement", card };
  }
  onPlaced?.(card, targetZone);
  emitCardPlacement(state, controllerId, card, targetZone, placementCause, sourceName);
  if (placementCause !== "access_drag") emitEffectPlacement(state, controllerId, card, targetZone, sourceName);
  return { status: "placed", card, zoneName: targetZone };
}

export function moveCardByEffect(state, playerId, uid, targetZone, sourceName) {
  const player = state.players[playerId];
  const sourceZone = player.front.some((card) => card.uid === uid) ? "front" : player.back.some((card) => card.uid === uid) ? "back" : null;
  if (!sourceZone || sourceZone === targetZone) return fail(state, "移動先は現在と異なるエリアを選んで。", false);
  if (!placementResult(player, targetZone).ok) return fail(state, "移動先エリアが上限。", false);
  const index = player[sourceZone].findIndex((card) => card.uid === uid);
  const [card] = player[sourceZone].splice(index, 1);
  const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
  if (placeByMode(state, playerId, card, { zone: targetZone, mode: "normal", from: sourceZone, source: sourceName }) !== "placed") return false;
  card.sleep = false;
  card.summoningSick = movedSummoningSick(state, card, targetZone);
  addLog(state, `${sourceName}: 「${card.name}」を${targetZone === "front" ? "フロント" : "バック"}へ効果で移動。`, "effect");
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は移動前のエリアに残る。`, "effect");
  triggerMoved(state, playerId, card, sourceZone, targetZone);
  return true;
}

function revealUnderlyingCard(zone, index, topCard, controllerId, zoneName) {
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

export function createVengeanceCard(state, cardId, ownerId) {
  return hydrateCard(createRuntimeCard(state.runtimeContext ?? null, cardId, ownerId, ++state.tokenSerial + 800));
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

function triggerObDestroyedExtras(state, destroyedCard) {
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

function resolveAccessDragPlacementCore(state, playerId, zone, underUid = null) {
  const pending = state.pending;
  if (!["access-drag-place", "decode-place", "std048-draw-place"].includes(pending?.type) || pending.playerId !== playerId) return false;
  const player = state.players[playerId];
  const uid = pending.queue[0];
  const card = pending.type === "decode-place"
    ? pending.cards.find((item) => item.uid === uid)
    : state.players[playerId].hand.find((item) => item.uid === uid);
  if (!card) return false;
  state.pending = null;
  if (pending.type === "decode-place") {
    const target = state.players[playerId][zone];
    const host = underUid ? target?.find((item) => item.uid === underUid && isObCard(item)) : null;
    if (!target || !(isObCard(card) || card.category === "Code") || (underUid && (!host || card.category !== "Code"))) { state.pending = pending; return false; }
    card.sleep = false;
    card.summoningSick = false;
    card.damage = 0;
    if (host) {
      card.layerRole = "code";
      host.mounted.push(card);
      addLog(state, `${pending.sourceName}: ${card.name}を${host.name}の下へ配置。`, "effect");
    } else {
      const outcome = placeByMode(state, playerId, card, { zone, from: "trash", source: pending.sourceName, suppressScriptWindow: true });
      if (outcome !== "placed") {
        const queue = pending.queue.slice(1); const cards = pending.cards?.filter((item) => item.uid !== uid);
        state.pending = queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null;
        return true;
      }
      addLog(state, `${pending.sourceName}: ${card.name}を${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
      emitEffectPlacement(state, playerId, card, zone, pending.sourceName);
    }
  } else {
    const placement = placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: uid, underUid, sourceName: pending.sourceName,
      placementCause: pending.type === "access-drag-place" ? "access_drag" : "effect",
      onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
    });
    if (["invalid", "missing", "rejected"].includes(placement.status)) {
      state.pending = pending;
      return false;
    }
  }
  const placed = findCard(state, card.uid)?.zoneName;
  if (pending.type === "std048-draw-place") {
    settleStd048MandatoryPlacement(state, pending, ["front", "back"].includes(placed));
    return true;
  }
  if (!["front", "back"].includes(placed)) {
    const queue = pending.queue.slice(1); const cards = pending.cards?.filter((item) => item.uid !== uid);
    state.pending = queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null;
    if (pending.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, pending.triggerItemId);
    return true;
  }
  const placedCard = findCard(state, card.uid)?.card;
  if (pending.enterSleep && placedCard) setCardSleeping(state, playerId, placedCard);
  if (pending.destroyAtTurnEnd) state.delayedEffects.push({ event: "turn_ended", turnPlayerId: pending.destroyTurnPlayerId,
    type: "destroy_card", ownerId: playerId, cardUid: card.uid, sourceName: pending.sourceName });
  const placementEffect = state.pending;
  const queue = pending.queue.slice(1);
  const cards = pending.cards?.filter((item) => item.uid !== uid);
  state.pending = placementEffect ?? (queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null);
  if (pending.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, pending.triggerItemId);
  return true;
}

export function resolveAccessDragPlacement(state, playerId, zone, underUid = null) {
  return runEffectEntry(state, "placement", playerId, () => resolveAccessDragPlacementCore(state, playerId, zone, underUid));
}
