import { hasKeyword, keywordValue } from "./effect-compiler.js";
import { destructionPermissionSpecsFor, executionCostModifierSpecsFor, mountEventSpecsFor, playerValueModifierSpecsFor } from "./continuous-effect-specs.js";
import { isLydCard, isObCard, matchesCardCategory } from "./card-types.js";
import { createAllocationSpec, createChoiceSpec, createSelectionRequest, createSelectionSpec, isSelectionRequestFeasible, selectionRequestFromSpec } from "./selection-model.js";
import { CARD_LIBRARY } from "../data/cards.js";
import { flattenedLayerCount, flattenedLayers, normalizeMountedStack } from "./layered-specs.js";
import { createRuntimeCard, createRuntimeToken, RuntimeError } from "./runtime/factory.js";
import { cardPlacementCostSpec, cardRuntimeSpec } from "./card-runtime-specs.js";
import { resultCountGate } from "./effect-operation-library.js";
import { inheritBoardSlot, normalizeZoneSlots, placeCardInBoardSlot, swapBoardSlots } from "./board-slots.js";
import { evaluatePlacement } from "./placement-policy.js";
import { damageModifierSpecsFor } from "./damage-modifier-specs.js";
import { attack, cardAtk, cardCurrentStr, cardHasKeyword, cardMaxStr, consumeProtect, continueAttackAfterCost, dealCardDamage, dealFortressDamage, resumeDeferredAttack } from "./core/battle.js";
import { continueDeferredDeclaredScriptCleanup, drainIndependentEffects, resolveEffect, resolveMandatoryStateChecks, runEffectEntry } from "./core/effects.js";
import { canPlayCard, continueDeferredSpellCleanup, finalizeDeferredSpellCleanup, getEffectTargets, notifyCardExecuted, playCard, playCardCore, relogCard, resolveLogin, resolveLogoutAfterAreaExit, resolveSpell, spellNeedsTarget } from "./core/play.js";
import { enqueueSelection, openNextQueuedSelection, selectionProjectionMeta } from "./core/projection.js";
import { continueDeferredDeclaredResponseCleanup, declareResponse } from "./core/response.js";
import { activateScript, openScriptActivationWindow, queueMemoryLimitIncreasePrompt, queueScriptPrompt } from "./core/scripts.js";
import { hydrateCard } from "./core/setup.js";
import { addLog, cardTraits, classKey, fail, findCard, hasClass, hasNoEffectText, isArmsBandCard, isArmsBandOb, isSlashSpell, otherPlayer, provisional, shuffle } from "./core/shared.js";
import { emitGameEvent, emitUserAbilityFeedback, resumeStalledTriggerThread, resumeTriggerThreadAfterSelection } from "./core/triggers.js";
import { completeTurnAfterDelayedEffects, drawCards, endTurn, resolveMadnessChecks, resumeMandatoryDrawContinuation } from "./core/turn.js";

export { supportsNormalScriptActivation, supportsDirectHandObExecution, relogPreparationKind, canDirectRelogAtSlot, installCheck, installCard, configurePlugin, recoverRegistryCard, canExecuteRegistryCard, executeRegistryCard, enabledSymbols, supportsAlternateScriptSetup, canExecuteAtSlot, canPlayCard, spellNeedsTarget, normalSpellSelection, normalExecutionCheck, normalCardEffectSelection, playCard, getEffectTargets, getActivatableEffects, activateCardEffect, getLayeredCandidates, getLayeredRequirement, getLayeredSelectionPlan, canPlayLayeredCard, playLayeredCard, relogCard } from "./core/play.js";
export { coordinatorProjectionBlocked, buildProjectionSpec, commitProjection, clearProjection, replaceProjection, restoreProjection, cloneForHistory, remember, undo, enqueueLegacyProjection, promoteLegacyQueueHead } from "./core/projection.js";
export { canAddSandboxCardToHand, addSandboxCardToHand, canOpeningMulligan, canKeepOpeningHand, openingMulligan, keepOpeningHand, DECK_OPTIONS, createGame } from "./core/setup.js";
export { resolveTriggerChoice, emitGameEvent } from "./core/triggers.js";
export { finishGameIfSettled } from "./core/effects.js";
export { drawCards, startTurn, restSecurity, canActivateTurbo, activateTurbo, endTurn } from "./core/turn.js";
export { activateScript, declinePrompt } from "./core/scripts.js";
export { cardAtk, cardMaxStr, cardCurrentStr, cardHasKeyword, getAttackTargets, canAttack, attack, dealCardDamage, dealFortressDamage } from "./core/battle.js";
export { declineResponse, activateResponse } from "./core/response.js";
export { findCard } from "./core/shared.js";

export const STD121_PLACEMENT_PERMIT = Symbol("STD-121 placement cost paid");

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

function clearComponents(target) {
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

export function executeTriggerAction(state, trigger, action) {
  const { source, event } = trigger;
  const controller = state.players[source.playerId];
  const enemyId = otherPlayer(source.playerId);
  if (action.type === "deal_damage" && action.target === "enemy_user") {
    dealFortressDamage(state, enemyId, action.amount, source.playerId, source.card.name);
  } else if (action.type === "deal_damage" && action.target === "enemy_front_all") {
    for (const target of [...state.players[enemyId].front]) dealCardDamage(state, enemyId, target.uid, action.amount, source.card.name);
  } else if (action.type === "recover_memory") {
    const before = controller.memory;
    controller.memory = Math.min(getMaxMemory(controller), controller.memory + action.amount);
    addLog(state, `${source.card.name}: メモリ ${before}→${controller.memory}。`, "effect");
  } else if (action.type === "draw" && action.target === "source_controller") {
    drawCards(state, source.playerId, action.amount);
    addLog(state, `${source.card.name}: カードを${action.amount}枚引く。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "source") {
    const atkField = action.duration === "turn" ? "tempAtk" : "permanentAtk";
    const strField = action.duration === "turn" ? "tempStr" : "permanentStr";
    source.card[atkField] = Number(source.card[atkField] ?? 0) + action.atk;
    source.card[strField] = Number(source.card[strField] ?? 0) + action.str;
    addLog(state, `${source.card.name}: ${action.atk >= 0 ? "+" : ""}${action.atk}/${action.str >= 0 ? "+" : ""}${action.str}。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "enemy_ob_all") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back]) {
      target.tempAtk = Number(target.tempAtk ?? 0) + action.atk;
      target.tempStr = Number(target.tempStr ?? 0) + action.str;
    }
    addLog(state, `${source.card.name}: 相手Obすべてをこのターン${action.atk}/0。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "own_battler") {
    const uid = trigger.event.attackerUid && findCard(state, trigger.event.attackerUid)?.playerId === source.playerId
      ? trigger.event.attackerUid : trigger.event.defenderUid;
    const target = findCard(state, uid)?.card;
    if (target) addTimedModifier(state, target, action, source.card.name);
  } else if (action.type === "modify_stats" && action.target === "own_ob_all") {
    for (const target of [...controller.front, ...controller.back].filter(isObCard)) addTimedModifier(state, target, action, source.card.name);
  } else if (action.type === "destroy_all" && action.target === "enemy_non_ob") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter((card) => !isObCard(card))) {
      destroyCard(state, enemyId, target.uid, { source: source.card.name, suppressReplacement: true });
    }
  } else if (action.type === "add_counter" && action.target === "enemy_ob_all") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)) {
      if (action.counter === "load") target.load = Number(target.load ?? 0) + Number(action.amount ?? 0);
      else {
        target.counters ??= {};
        target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + Number(action.amount ?? 0);
      }
    }
    addLog(state, `${source.card.name}: 相手Obすべてに${action.counter}を${action.amount}付与。`, "effect");
  } else if (action.type === "move_event_card" && action.source === "trash" && action.destination === "hand") {
    const index = controller.trash.findIndex((card) => card.uid === event.cardUid);
    if (index >= 0) controller.hand.push(...controller.trash.splice(index, 1));
    addLog(state, `${source.card.name}: ${event.cardName}をゴミ箱から手札へ戻した。`, "effect");
  } else if (action.type === "select_execute_from_trash") {
    const candidates = controller.trash.filter((card) => {
      if (action.filter?.category && !matchesCardCategory(card, action.filter.category)) return false;
      if (action.filter?.excludeCategory && matchesCardCategory(card, action.filter.excludeCategory)) return false;
      if (action.filter?.namePattern === "slash_spell" && !isSlashSpell(card)) return false;
      if (action.filter?.maximumCost !== undefined && Number(card.cost ?? 0) > Number(action.filter.maximumCost)) return false;
      return true;
    });
    if (!candidates.length) return;
    const request = createSelectionRequest({
      mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, `${card.name} / メモリ${card.cost}`])),
      label: "ゴミ箱から起動するSpを選択", message: source.card.text,
      continuation: {
        type: "runtime-execute-from-trash", playerId: source.playerId, sourceUid: source.card.uid,
        sourceName: source.card.name, destinationAfterExecution: action.destinationAfterExecution,
        shuffleAfter: Boolean(action.shuffleAfter), triggerItemId: trigger.id
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (action.type === "add_counter" && action.target === "enemy_user") {
    const target = state.players[enemyId];
    target.counters ??= {};
    target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + action.amount;
    addLog(state, `${source.card.name}: 相手ユーザーへ${action.counter}カウンター${action.amount}個。`, "effect");
  } else if (action.type === "add_counter" && action.target === "enemy_battler") {
    const uid = trigger.event.attackerUid === source.card.uid ? trigger.event.defenderUid : trigger.event.attackerUid;
    const target = findCard(state, uid)?.card;
    if (target) {
      target.load = Number(target.load ?? 0) + action.amount;
      addLog(state, `${source.card.name}: ${target.name}へ[負荷]${action.amount}。`, "effect");
    }
  } else if (action.type === "choose_effect") {
    const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①相手の手札を1枚捨てる", "②相手Obに毒カウンター2"] }), {
      label: `${source.card.name}: ①または②`, message: source.card.text,
      continuation: { type: "std164-choice", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id }
    });
    state.pending = { type: "selection", validTargets: [], request };
  } else if (action.type === "select" && action.selector && typeof action.selector === "object") {
    openRuntimeTargetSelection(state, source.playerId, source.card, action, { records: Object.create(null) }, { triggerItemId: trigger.id });
  } else if (action.type === "select_entity" && action.scope === "all_users_and_all_area_ob") {
    const cards = Object.values(state.players).flatMap((owner) => [...owner.front, ...owner.back]).filter(isObCard);
    const users = Object.keys(state.players).map((id) => `${id}-fortress`);
    const request = createSelectionRequest({
      mode: "single", candidates: [...users, ...cards.map((card) => card.uid)], count: 1,
      candidateLabels: {
        ...Object.fromEntries(Object.entries(state.players).map(([id, owner]) => [`${id}-fortress`, owner.user.name])),
        ...Object.fromEntries(cards.map((card) => [card.uid, card.name]))
      },
      label: `${source.card.name}: [負荷]1`, message: source.card.text,
      continuation: { type: "trigger-selected-entity-action", playerId: source.playerId, sourceName: source.card.name, action: action.then, triggerItemId: trigger.id }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (action.type === "standby") {
    source.card.sleep = false;
    addLog(state, `${source.card.name}: スタンバイ。`, "effect");
  } else if (action.type === "generate") {
    const destination = action.destination === "event_from_zone" ? event.from : action.destination;
    for (let index = 0; index < action.count; index += 1) {
      const card = createVengeanceCard(state, action.cardId, source.playerId);
      const zone = destination === "choose_area" ? (controller.front.length < controller.user.frontLimit ? "front" : controller.back.length < controller.user.backLimit ? "back" : "front") : destination;
      if (!["front", "back", "hand"].includes(zone)) continue;
      if (["front", "back"].includes(zone)) {
        if (placeByMode(state, source.playerId, card, { zone, from: "generated", source: source.card.name }) === "placed") emitEffectPlacement(state, source.playerId, card, zone, source.card.name);
      } else controller[zone].push(card);
    }
    addLog(state, `${source.card.name}: 「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "generate_as_layer_for_each") {
    const targets = runtimeSelectionCandidates(state, source.playerId, source.card, { selector: action.selector });
    const generated = [];
    for (const host of targets) {
      const layer = createVengeanceCard(state, action.cardId, source.playerId);
      layer.layerRole = "layered";
      host.mounted.push(layer);
      generated.push(layer);
    }
    if (generated.length) emitCardsGenerated(state, source.playerId, generated, source.card.name);
    addLog(state, `${source.card.name}: 対象${targets.length}枚のレイヤーに「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "generate_as_layer" && action.target === "event_card") {
    const host = findCard(state, event.cardUid)?.card;
    if (!host) return;
    const layer = createVengeanceCard(state, action.cardId, source.playerId);
    layer.layerRole = "layered";
    host.mounted.push(layer);
    emitCardsGenerated(state, source.playerId, [layer], source.card.name);
    addLog(state, `${source.card.name}: ${host.name}のレイヤーに「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "move_each_deck_top_as_layer" && action.target === "source") {
    let moved = 0;
    for (const ownerId of ["player", "ai"]) {
      const layer = state.players[ownerId].deck.pop();
      if (!layer) continue;
      layer.layerRole = "layered";
      source.card.mounted.push(layer);
      moved += 1;
    }
    addLog(state, `${source.card.name}: お互いの山札上から合計${moved}枚をレイヤーに加えた。`, "effect");
  } else if (action.type === "access" && action.matchCategory === "event_card") {
    const index = controller.deck.findIndex((card) => matchesCardCategory(card, event.category));
    if (index >= 0) {
      const [found] = controller.deck.splice(index, 1);
      controller.hand.push(found);
      addLog(state, `${source.card.name}: ${event.category}「${found.name}」へアクセス。`, "effect");
    }
  } else if (action.type === "access" && action.filter) {
    openRuntimeAccessSelection(state, source.playerId, source.card, action, null, null, { triggerItemId: trigger.id });
  } else if (action.type === "access" && action.destination === "hand") {
    const candidates = controller.deck.filter((card) => (!action.matchCategory || matchesCardCategory(card, action.matchCategory)) && (!action.matchColor || card.color === action.matchColor));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${source.card.name}のアクセス`, message: source.card.text,
        continuation: { type: "q2-access-hand", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id } });
      enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-access", source.playerId));
    }
  } else if (action.type === "select" && action.selector === "one_own_and_one_enemy_ob") {
    const own = [...controller.front, ...controller.back].filter(isObCard).map((card) => card.uid);
    const enemy = [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard).map((card) => card.uid);
    if (!own.length || !enemy.length) return;
    const request = createSelectionRequest({
      mode: "exact", candidates: [...own, ...enemy], count: 2,
      label: "自分と相手のObを1体ずつ選択", message: "2体とも選んだ場合、それらを破壊する。",
      groups: [
        { id: "own", label: "自分Ob", candidates: own, minimum: 1, maximum: 1 },
        { id: "enemy", label: "相手Ob", candidates: enemy, minimum: 1, maximum: 1 }
      ],
      continuation: { type: "destroy-selected", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id }
    });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-paired-destroy", source.playerId));
  } else if (action.type === "select" && ["one_non_ob", "one_own_ob", "one_enemy_ob"].includes(action.selector)) {
    const candidates = action.selector === "one_own_ob"
      ? [...controller.front, ...controller.back].filter(isObCard)
      : action.selector === "one_enemy_ob"
        ? [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)
      : Object.values(state.players).flatMap((player) => [...player.front, ...player.back]).filter((card) => !isObCard(card));
    if (!candidates.length) return;
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "効果対象を選択", message: source.card.text,
      continuation: { type: action.then === "destroy" ? "destroy-selected" : action.then === "deal_damage" ? "deal-selected-damage" : action.then === "modify_and_prevent_battle_damage" ? "trigger-modify-prevent-battle" : "trigger-modify-grant", playerId: source.playerId,
        ...(action.amount !== undefined ? { amount: action.amount } : {}),
        sourceName: source.card.name, triggerItemId: trigger.id, action } });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-select", source.playerId));
  }
}

function addTimedModifier(state, card, action, sourceName) {
  const expiresAfterTurn = action.duration === "through_next_turn" ? state.turnNumber + 1 : state.turnNumber;
  (card.timedModifiers ??= []).push({ atk: Number(action.atk ?? 0), str: Number(action.str ?? 0), keyword: action.keyword ?? null, expiresAfterTurn });
  addLog(state, `${sourceName}: ${card.name}を${action.atk >= 0 ? "+" : ""}${action.atk}/${action.str >= 0 ? "+" : ""}${action.str}${action.keyword ? `、[${action.keyword}]付与` : ""}。`, "effect");
}

export function resolveVariableExpression(state, playerId, expression) {
  let runtimeExpression = null;
  if (expression.aggregate === "absolute_user_life_difference") runtimeExpression = { expression: "absolute_user_str_difference" };
  if (expression.count === "own_area_security") runtimeExpression = { expression: "own_area_filter_count", filter: { keyword: "SECURITY" } };
  if (expression.countUnion) runtimeExpression = {
    expression: "own_trash_filter_union_count",
    filters: [
      ...(expression.countUnion.includes("own_trash_nom") ? [{ className: "ナイツ・オブ・マキナ" }] : []),
      ...(expression.countUnion.includes("own_trash_security") ? [{ keyword: "SECURITY" }] : [])
    ]
  };
  const value = runtimeExpression ? runtimeSpecValue(state, playerId, {}, runtimeExpression) : 0;
  return Math.max(0, value + Number(expression.add ?? 0));
}

export function runtimeSpecValue(state, playerId, source, value, runtime = null) {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  const expression = value?.expression;
  const player = state.players[playerId];
  if (expression === "turn_number") return state.turnNumber;
  if (expression === "source_layer_count") return flattenedLayerCount(source);
  if (expression === "source_stack_count") return 1 + flattenedLayerCount(source);
  if (expression === "source_lyd_layer_count") {
    return flattenedLayers(source).filter(isLydCard).length;
  }
  if (expression === "own_area_security_count" || expression === "own_area_security_count_plus_one") {
    const count = [...player.front, ...player.back].filter((card) => cardHasKeyword(card, "SECURITY")).length;
    return count + (expression.endsWith("plus_one") ? 1 : 0);
  }
  if (expression === "registry_execution_damage") return source.executedFromRegistry ? value.registry : value.normal;
  if (expression === "recorded_count") return Number(runtime?.records?.[value.key] ?? 0);
  if (expression === "recorded_count_divided_floor") {
    return Math.floor(Number(runtime?.records?.[value.key] ?? 0) / Math.max(1, Number(value.divisor ?? 1)));
  }
  if (expression === "recorded_value") return runtime?.records?.[value.key];
  if (expression === "absolute_user_str_difference") {
    return Math.abs(Number(player.fortressStr) - Number(state.players[otherPlayer(playerId)].fortressStr));
  }
  if (expression === "own_area_filter_count") {
    return [...player.front, ...player.back].filter((card) => runtimeSpecMatchesCard(card, value.filter, null, { state, playerId, source, runtime })).length;
  }
  if (expression === "own_trash_filter_union_count") {
    return player.trash.filter((card) => value.filters.some((filter) => runtimeSpecMatchesCard(card, filter, null, { state, playerId, source, runtime }))).length;
  }
  throw new Error(`Unsupported card runtime value expression: ${expression ?? "(missing)"}`);
}

function runtimeSpecCondition(state, playerId, source, condition, runtime = null, targetUid = null) {
  if (!condition) return true;
  const player = state.players[playerId];
  if (condition.expression === "source_has_lyd_layer") return runtimeSpecValue(state, playerId, source, { expression: "source_lyd_layer_count" }) > 0;
  if (condition.expression === "another_own_ob_has_security") {
    return [...player.front, ...player.back].some((card) => card.uid !== source.uid && isObCard(card) && cardHasKeyword(card, "SECURITY"));
  }
  if (condition.expression === "recorded_damage_destroyed") return Boolean(runtime?.records?.[condition.key]?.destructionDetermined);
  if (condition.expression === "selected_target_is_sleeping_ob") {
    const target = findCard(state, targetUid);
    return target?.playerId === otherPlayer(playerId)
      && ["front", "back"].includes(target.zoneName)
      && isObCard(target.card)
      && target.card.sleep;
  }
  if (condition.expression === "opponent_turn") return state.active !== playerId;
  if (condition.expression === "own_area_has_class_ob") {
    return [...player.front, ...player.back].some((card) => isObCard(card) && hasClass(card, condition.className));
  }
  if (condition.expression === "source_is_mounted") return Boolean(source.mounted?.length);
  if (condition.expression === "source_oc_paid_at_least") return Number(source.ocPaidAmount ?? 0) >= Number(condition.amount ?? 0);
  if (condition.expression === "recorded_count_positive") return Number(runtime?.records?.[condition.key] ?? 0) > 0;
  if (condition.expression === "recorded_value_equals") {
    const recorded = runtime?.records?.[condition.key];
    return /category/i.test(condition.key)
      ? matchesCardCategory({ category: recorded }, condition.value)
      : recorded === condition.value;
  }
  if (condition.expression === "recorded_value_not_equals") {
    if (condition.requiresKey && !Object.hasOwn(runtime?.records ?? {}, condition.key)) return false;
    const recorded = runtime?.records?.[condition.key];
    return /category/i.test(condition.key)
      ? !matchesCardCategory({ category: recorded }, condition.value)
      : recorded !== condition.value;
  }
  if (condition.expression === "own_user_str_less_than_opponent") {
    return Number(player.fortressStr) < Number(state.players[otherPlayer(playerId)].fortressStr);
  }
  if (condition.expression === "source_controller_memory_equals") return Number(player.memory) === Number(condition.amount ?? 0);
  if (condition.expression === "source_attacked_this_turn") return Boolean(source.attackedThisTurn);
  throw new Error(`Unsupported card runtime condition: ${condition.expression ?? "(missing)"}`);
}

function runtimeSpecTargets(state, playerId, source, targetUid, target) {
  const player = state.players[playerId];
  if (target === "source") return [source];
  if (target === "own_ob_all") return [...player.front, ...player.back].filter(isObCard);
  if (target === "own_mounted_ob_all") {
    return [...player.front, ...player.back].filter((card) => isObCard(card) && card.mounted?.length);
  }
  if (target === "own_class_ob_all") {
    return [...player.front, ...player.back].filter((card) => isObCard(card) && hasClass(card, source.runtimeTargetClass));
  }
  if (target === "selected_own_ob") {
    const entry = findCard(state, targetUid);
    return entry?.playerId === playerId && isObCard(entry.card) ? [entry.card] : [];
  }
  if (target === "selected_enemy_ob") {
    const entry = findCard(state, targetUid);
    return entry?.playerId === otherPlayer(playerId) && isObCard(entry.card) ? [entry.card] : [];
  }
  throw new Error(`Unsupported card runtime target: ${target ?? "(missing)"}`);
}

function runtimeFieldValues(card, field) {
  const values = Array.isArray(card?.[field]) ? card[field] : card?.[field] === undefined ? [] : [card[field]];
  return field === "classes" ? values.map(classKey) : values.map(String);
}

function runtimeSpecMatchesCard(card, filter = {}, referenceCard = null, context = null) {
  const filterValue = (value) => value?.expression && context
    ? runtimeSpecValue(context.state, context.playerId, context.source, value, context.runtime)
    : value;
  if (filter.anyOf && !filter.anyOf.some((branch) => runtimeSpecMatchesCard(card, branch, referenceCard, context))) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.excludeCategory && matchesCardCategory(card, filter.excludeCategory)) return false;
  if (filter.printedCategory && card.printedCategory !== filter.printedCategory) return false;
  if (filter.categories && !filter.categories.some((category) => matchesCardCategory(card, category))) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.className && !hasClass(card, filter.className)) return false;
  if (filter.keyword && !cardHasKeyword(card, filter.keyword)) return false;
  if (filter.trait && !cardTraits(card).includes(filter.trait)) return false;
  if (filter.family === "arms_band" && !isArmsBandCard(card)) return false;
  if (filter.name && card.name !== filter.name) return false;
  if (filter.nameIncludes && !card.name.includes(filter.nameIncludes)) return false;
  if (filter.normalizedName && card.name.replace(/[「」]/g, "") !== filter.normalizedName) return false;
  if (filter.excludeSourceName && card.name === context?.source?.name) return false;
  if (filter.nameStartsWith && !card.name.startsWith(filter.nameStartsWith)) return false;
  if (filter.nameEndsWith && !card.name.endsWith(filter.nameEndsWith)) return false;
  if (filter.effectText === "none" && !hasNoEffectText(card)) return false;
  if (filter.originalMemoryMaximum !== undefined && Number(card.cost ?? 0) > Number(filterValue(filter.originalMemoryMaximum))) return false;
  if (filter.originalMemoryMinimum !== undefined && Number(card.cost ?? 0) < Number(filterValue(filter.originalMemoryMinimum))) return false;
  if (filter.originalMemoryMaximumExclusive !== undefined && Number(card.cost ?? 0) >= Number(filterValue(filter.originalMemoryMaximumExclusive))) return false;
  if (filter.originalSetupMemoryMaximum !== undefined && Number(card.setupCost ?? card.cost ?? 0) > Number(filter.originalSetupMemoryMaximum)) return false;
  if (filter.sharesFieldWithReference) {
    const candidateValues = runtimeFieldValues(card, filter.sharesFieldWithReference);
    const referenceValues = new Set(runtimeFieldValues(referenceCard, filter.sharesFieldWithReference));
    if (!candidateValues.some((value) => referenceValues.has(value))) return false;
  }
  return true;
}

function runtimeAccessCandidates(player, action, referenceCard = null) {
  return player.deck.filter((card) => runtimeSpecMatchesCard(card, action.filter, referenceCard));
}

function runtimeSelectionCandidates(state, playerId, source, action, runtime = { records: Object.create(null) }) {
  const selector = action.selector ?? {};
  const ownerScope = selector.owner ?? "both";
  const ownerIds = ownerScope === "both"
    ? [playerId, otherPlayer(playerId)]
    : ownerScope === "enemy" ? [otherPlayer(playerId)] : [playerId];
  const candidates = [];
  for (const ownerId of ownerIds) {
    const owner = state.players[ownerId];
    if (selector.effectTargeting) {
      candidates.push(...getEffectTargets(state, ownerId, source));
      continue;
    }
    for (const zone of selector.zones ?? ["area"]) {
      if (zone === "area") candidates.push(...owner.front, ...owner.back);
      else if (zone === "layers") candidates.push(...ownLayerEntries(owner).map((entry) => entry.layer));
      else if (Array.isArray(owner[zone])) candidates.push(...owner[zone]);
    }
  }
  return candidates.filter((card) => {
    if (card.uid === (selector.excludeSource ? source.uid : null) || !runtimeSpecMatchesCard(card, selector)) return false;
    if (selector.correspondsToRecordedHost) {
      const recorded = runtime.records?.[selector.correspondsToRecordedHost];
      const hostUid = Array.isArray(recorded) ? recorded[0] : recorded;
      const host = findCard(state, hostUid)?.card;
      if (!host) return false;
      const requirement = String(keywordValue(host, "LAYERED") ?? "");
      if (!requirement.includes(card.name) && !(card.classes ?? []).some((name) => requirement.includes(name))) return false;
    }
    return true;
  });
}

function openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta = {}) {
  const candidates = runtimeSelectionCandidates(state, playerId, source, action, runtime);
  if (!candidates.length && action.continueWhenEmpty) {
    return action.skipAfterActionsWhenEmpty
      ? true
      : executeRuntimeActions(state, playerId, source, action.afterActions ?? [], { targetUid: null, runtime });
  }
  const minimum = Math.max(0, Number(action.minimum ?? action.count ?? 1));
  const configuredMaximum = action.maximum === "all" ? candidates.length : Number(action.maximum ?? action.count ?? 1);
  const maximum = Math.min(candidates.length, Math.max(0, configuredMaximum));
  if (candidates.length < minimum) return false;
  const mode = action.mode ?? (minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to");
  const request = createSelectionRequest({
    mode,
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: action.label ?? `${source.name}: 対象を選択`,
    message: source.text,
    continuation: {
      type: "runtime-action-selection",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      selector: action.selector ?? {},
      recordAs: action.recordAs,
      minimum,
      maximum,
      afterActions: action.afterActions ?? [],
      skipAfterActionsWhenEmpty: Boolean(action.skipAfterActionsWhenEmpty),
      runtime,
      ...continuationMeta
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function runtimePlayerCandidates(state, action) {
  return Object.entries(state.players)
    .filter(([, player]) => !action.filter?.trashNonEmpty || player.trash.length > 0)
    .map(([id]) => id);
}

function openRuntimePlayerSelection(state, playerId, source, action, runtime) {
  const candidates = runtimePlayerCandidates(state, action);
  if (!candidates.length) return false;
  const request = createSelectionRequest({
    mode: "single", candidates, count: 1,
    candidateLabels: Object.fromEntries(candidates.map((id) => [id, state.players[id].user.name])),
    label: `${source.name}: ユーザーを選択`, message: source.text,
    continuation: {
      type: "runtime-player-selection", playerId, sourceId: source.id, sourceUid: source.uid, sourceName: source.name,
      candidates, recordAs: action.recordAs, afterActions: action.afterActions ?? [], runtime
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function runtimeAccessBounds(action, candidateCount) {
  const configuredMaximum = action.maximum === "all" ? candidateCount : Number(action.maximum ?? action.count ?? 1);
  return {
    maximum: Math.min(candidateCount, Math.max(0, configuredMaximum)),
    minimum: Math.max(0, Number(action.minimum ?? action.count ?? 1))
  };
}

function runtimeReferenceCandidates(player, source, action) {
  if (!action.referenceSelection) return [];
  const zone = action.referenceSelection.source === "own_hand" ? player.hand : [];
  return zone.filter((card) => card.uid !== source.uid && runtimeAccessCandidates(player, action, card).length >= runtimeAccessBounds(action, runtimeAccessCandidates(player, action, card).length).minimum);
}

function runtimeSourceFromContinuation(state, continuation) {
  const source = {
    ...(CARD_LIBRARY[continuation.sourceId] ?? {}),
    id: continuation.sourceId,
    uid: continuation.sourceUid,
    name: continuation.sourceName,
    ...(continuation.sourceRuntime ?? {})
  };
  if (state.runtimeContext) {
    const alias = state.runtimeContext.uidAliases.find((entry) => entry.uid === continuation.sourceUid);
    if (!alias) throw new RuntimeError("RUNTIME_UNKNOWN_SOURCE_ALIAS");
    source.identity = { ...alias.identity };
    source.ownerSeat = alias.ownerSeat;
  }
  return source;
}

function openRuntimeAccessSelection(state, playerId, source, action, referenceCard = null, revealedUid = null, continuationMeta = {}) {
  const player = state.players[playerId];
  if (action.referenceSelection && !referenceCard) {
    const references = runtimeReferenceCandidates(player, source, action);
    if (!references.length) return false;
    const request = createSelectionRequest({
      mode: "single",
      candidates: references.map((card) => card.uid),
      count: 1,
      candidateLabels: Object.fromEntries(references.map((card) => [card.uid, card.name])),
      label: `${source.name}: 参照するカードを選択`,
      message: source.text,
      continuation: {
        type: "runtime-access-reference", playerId, sourceId: source.id, sourceUid: source.uid,
        sourceName: source.name, action
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = runtimeAccessCandidates(player, action, referenceCard);
  const { minimum, maximum } = runtimeAccessBounds(action, candidates.length);
  if (candidates.length < minimum) return false;
  const mode = action.mode ?? (minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to");
  const destinationType = action.destination === "drag"
    ? "access-drag"
    : action.destination === "distribute"
      ? "access-distribute"
      : "access-to-hand";
  const request = createSelectionRequest({
    mode,
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${source.name}: アクセスするカードを選択`,
    message: source.text,
    continuation: {
      type: destinationType,
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      sourceRuntime: {
        ocPaidAmount: source.ocPaidAmount,
        executedFromRegistry: source.executedFromRegistry
      },
      enterSleep: Boolean(action.enterSleep),
      destinations: action.destinations,
      afterActions: action.afterActions,
      revealSelected: Boolean(action.reveal),
      revealedUid,
      ...continuationMeta
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function runtimeActionCandidates(state, playerId, source, action, runtime) {
  if (action.type !== "decode") return [];
  const context = { state, playerId, source, runtime };
  return state.players[playerId].trash.filter((card) => runtimeSpecMatchesCard(card, action.filter, null, context)
    && (action.totalOriginalMemoryMaximum === undefined || Number(card.cost ?? 0) <= Number(action.totalOriginalMemoryMaximum)));
}

export function runtimeActionFeasible(state, playerId, source, action, runtime) {
  if (action.type === "select") {
    return runtimeSelectionCandidates(state, playerId, source, action, runtime).length >= Number(action.minimum ?? action.count ?? 1);
  }
  if (action.type === "select_player") return runtimePlayerCandidates(state, action).length > 0;
  if (action.type === "choose_zone") return runtimeZoneChoiceOptions(state, playerId, source, action).length > 0;
  if (action.type === "move" && action.target === "recorded_cards") {
    const recorded = runtime.records?.[action.recordKey];
    const uid = Array.isArray(recorded) ? recorded[0] : recorded;
    const location = findCard(state, uid);
    if (!location || location.zoneName !== action.source) return false;
    return action.destination !== "back" || placementResult(state.players[location.playerId], "back").ok;
  }
  if (action.type === "move" && action.target === "activation_target") {
    const location = findCard(state, runtime.records?.activation_target_uid);
    const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
    return location?.playerId === playerId
      && ["front", "back"].includes(location.zoneName)
      && isObCard(location.card)
      && ["front", "back"].includes(destination)
      && location.zoneName !== destination
      && placementResult(state.players[playerId], destination).ok;
  }
  if (action.type === "destroy" && action.target === "activation_target") {
    const location = findCard(state, runtime.records?.activation_target_uid);
    return Boolean(location && ["front", "back"].includes(location.zoneName));
  }
  if (action.type !== "decode") return true;
  return runtimeActionCandidates(state, playerId, source, action, runtime).length >= Number(action.minimum ?? action.count ?? 1);
}

export function triggerActionFeasible(state, playerId, action) {
  const enemyId = otherPlayer(playerId);
  if (action.type === "select") {
    if (action.selector === "one_own_ob") return [...state.players[playerId].front, ...state.players[playerId].back].some(isObCard);
    if (action.selector === "one_enemy_ob") return [...state.players[enemyId].front, ...state.players[enemyId].back].some(isObCard);
    if (action.selector === "one_non_ob") return Object.values(state.players).some((player) => [...player.front, ...player.back].some((card) => !isObCard(card)));
  }
  if (action.type === "destroy_all" && action.target === "enemy_non_ob") {
    return [...state.players[enemyId].front, ...state.players[enemyId].back].some((card) => !isObCard(card));
  }
  return true;
}

function openRuntimeDecodeSelection(state, playerId, source, action, runtime) {
  const candidates = runtimeActionCandidates(state, playerId, source, action, runtime);
  const minimum = Math.max(0, Number(action.minimum ?? action.count ?? 1));
  const maximum = Math.min(candidates.length, Math.max(0, Number(action.maximum ?? action.count ?? 1)));
  if (candidates.length < minimum) return false;
  const request = createSelectionRequest({
    mode: minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${source.name}: デコードするカードを選択`,
    message: source.text,
    continuation: {
      type: "runtime-decode",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      runtime,
      enterSleep: Boolean(action.enterSleep),
      destroyAtTurnEnd: Boolean(action.destroyAtTurnEnd),
      destroyTurnPlayerId: action.destroyAtTurnEnd ? state.active : null
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function openRuntimeChoiceSelection(state, playerId, source, action, runtime) {
  if (action.recordAs) runtime.records[action.recordAs] = runtimeSpecValue(state, playerId, source, action.value, runtime);
  const choices = action.choices.filter((choice) => choice.actions.every((nested) => runtimeActionFeasible(state, playerId, source, nested, runtime)));
  if (!choices.length) return false;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: choices.map((choice) => choice.label) }), {
    label: `${source.name}: 効果を選択`,
    message: action.recordAs ? `X=${runtime.records[action.recordAs]}` : source.text,
    continuation: {
      type: "runtime-effect-choice",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      choices,
      runtime
    }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

function runtimeZoneChoiceOptions(state, playerId, source, action) {
  const location = findCard(state, source.uid);
  if (location?.playerId !== playerId || !["front", "back"].includes(location.zoneName)) return [];
  const requested = action.destinations === "other_area"
    ? [location.zoneName === "front" ? "back" : "front"]
    : action.destinations ?? [];
  return requested.filter((zone) => ["front", "back"].includes(zone) && placementResult(state.players[playerId], zone).ok);
}

function openRuntimeZoneChoice(state, playerId, source, action, runtime) {
  const location = findCard(state, source.uid);
  const options = runtimeZoneChoiceOptions(state, playerId, source, action);
  if (!location || !options.length) return false;
  const request = createSelectionRequest({
    mode: "scope", scopeField: "destination", scopeOptions: options,
    label: `${source.name}: 移動先を選択`, message: source.text,
    continuation: {
      type: "runtime-zone-choice", playerId, sourceId: source.id, sourceUid: source.uid, sourceName: source.name,
      options, sourceZone: location.zoneName, sourceZoneRecord: action.sourceZoneRecord,
      destinationRecord: action.destinationRecord, afterActions: action.afterActions ?? [], runtime
    }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function runtimeSpellAccessFailure(state, playerId, card) {
  const spec = cardRuntimeSpec(card.id, "spell");
  if (!spec) return null;
  const player = state.players[playerId];
  for (const action of spec.actions.filter((item) => item.type === "select_player")) {
    if (!runtimePlayerCandidates(state, action).length) return "条件を満たすユーザーがいない。";
  }
  for (const action of spec.actions.filter((item) => item.type === "access")) {
    if (action.referenceSelection) {
      if (!runtimeReferenceCandidates(player, card, action).length) return "参照条件を満たすアクセス先がない。";
      continue;
    }
    const candidates = runtimeAccessCandidates(player, action);
    if (candidates.length < runtimeAccessBounds(action, candidates.length).minimum) return "条件を満たすアクセス先が足りない。";
  }
  return null;
}

function queueRuntimeDestructionContinuation(state, targetUid, continuation) {
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

function settleDestructionContinuations(state, targetUid, destroyed) {
  const runtime = settleRuntimeDestructionContinuation(state, targetUid, destroyed);
  const sacredTree = settleStd142DestructionContinuation(state, targetUid, destroyed);
  const scrapPatchwork = settleStd211DestructionContinuation(state, targetUid, destroyed);
  const placementCost = settlePlacementCostDestruction(state, targetUid, destroyed);
  return runtime || sacredTree || scrapPatchwork || placementCost;
}

export function continueStd211DestructionBatch(state) {
  const batch = state.std211DestructionBatch;
  if (!batch || state.pending || state.prompt || state.deferredDestruction) return false;
  const player = state.players[batch.playerId];
  while (batch.queue.length) {
    const targetUid = batch.queue.shift();
    const target = findCard(state, targetUid);
    if (!target || target.playerId !== batch.playerId || !["front", "back"].includes(target.zoneName)
      || !(target.card.classes ?? []).some((value) => classKey(value) === classKey(batch.className))) continue;
    (state.std211DestructionContinuations ??= {})[targetUid] = true;
    destroyCard(state, batch.playerId, targetUid, { source: batch.sourceName, suppressReplacement: true });
    return true;
  }
  const resultGate = resultCountGate(batch.destroyedCount);
  if (resultGate.shouldResolveDependentBlock) {
    drawCards(state, batch.playerId, resultGate.count);
    addLog(state, `${batch.sourceName}: クラス「${batch.className}」を${resultGate.count}枚破壊し、${resultGate.count}枚ドロー。`, "effect");
  } else {
    addLog(state, `${batch.sourceName}: 破壊実績が0枚のため、後続のドロー処理を行わず終了。`, "effect");
  }
  delete state.std211DestructionBatch;
  return continueDeferredSpellCleanup(state);
}

function settleStd211DestructionContinuation(state, targetUid, destroyed) {
  if (!state.std211DestructionContinuations?.[targetUid]) return false;
  delete state.std211DestructionContinuations[targetUid];
  if (!Object.keys(state.std211DestructionContinuations).length) delete state.std211DestructionContinuations;
  if (destroyed) state.std211DestructionBatch.destroyedCount += 1;
  return continueStd211DestructionBatch(state);
}

export function executeRuntimeActions(state, playerId, source, actions, { targetUid = null, targetUids = [], runtime = { records: Object.create(null) }, continuationMeta = {} } = {}) {
  const player = state.players[playerId];
  const enemyId = otherPlayer(playerId);
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    if (!runtimeSpecCondition(state, playerId, source, action.condition, runtime, targetUid)) continue;
    const amount = action.amount === undefined ? 0 : Number(runtimeSpecValue(state, playerId, source, action.amount, runtime));
    if (action.type === "select") {
      return openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta);
    } else if (action.type === "select_player") {
      return openRuntimePlayerSelection(state, playerId, source, action, runtime);
    } else if (action.type === "choose_zone") {
      return openRuntimeZoneChoice(state, playerId, source, action, runtime);
    } else if (action.type === "deal_damage" && action.target === "enemy_user") {
      dealFortressDamage(state, enemyId, amount, playerId, source.name);
    } else if (action.type === "deal_damage" && action.target === "self_user") {
      dealFortressDamage(state, playerId, amount, playerId, source.name);
    } else if (action.type === "deal_damage" && action.target === "selected_enemy_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) {
        state.lastDamageOutcome = null;
        dealCardDamage(state, enemyId, target.uid, amount, source.name, { sourcePlayerId: playerId });
        if (action.recordAs) runtime.records[action.recordAs] = state.lastDamageOutcome;
      }
    } else if (action.type === "deal_damage" && action.target === "attack_target") {
      if (targetUid === `${enemyId}-fortress`) dealFortressDamage(state, enemyId, amount, playerId, source.name);
      else {
        const target = findCard(state, targetUid);
        if (target) dealCardDamage(state, target.playerId, target.card.uid, amount, source.name, { sourcePlayerId: playerId });
      }
    } else if (action.type === "deal_damage" && action.target === "random_enemy_ob") {
      const candidates = [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard);
      const target = candidates[Math.floor(state.rng() * candidates.length)];
      if (target) dealCardDamage(state, enemyId, target.uid, amount, source.name, { sourcePlayerId: playerId });
    } else if (action.type === "draw") {
      const drawPlayerId = action.target === "recorded_player" ? runtime.records?.[action.playerRecord] : playerId;
      if (!state.players[drawPlayerId]) return false;
      drawCards(state, drawPlayerId, amount);
    } else if (action.type === "recover_memory" && action.target === "source_controller") {
      const before = player.memory;
      player.memory = Math.min(getMaxMemory(player), player.memory + amount);
      addLog(state, `${source.name}: メモリ ${before}→${player.memory}。`, "effect");
    } else if (action.type === "recover_memory" && action.target === "recorded_player") {
      const beneficiary = state.players[runtime.records?.[action.playerRecord]];
      if (!beneficiary) return false;
      const before = beneficiary.memory;
      beneficiary.memory = Math.min(getMaxMemory(beneficiary), beneficiary.memory + amount);
      addLog(state, `${source.name}: 所持ユーザーのメモリ ${before}→${beneficiary.memory}。`, "effect");
    } else if (action.type === "consume_memory") {
      const target = action.target === "enemy_player" ? state.players[enemyId] : player;
      const consumed = Math.min(Math.max(0, amount), Math.max(0, Number(target.memory ?? 0)));
      target.memory -= consumed;
      if (action.recordAs) runtime.records[action.recordAs] = consumed;
      addLog(state, `${source.name}: ${action.target === "enemy_player" ? "相手の" : ""}使用可能メモリを${consumed}消費。`, "effect");
    } else if (action.type === "schedule_delayed") {
      state.delayedEffects.push({
        event: action.event,
        ...(action.timing === "current_turn_end" ? { turnPlayerId: state.active } : {}),
        ...(action.timing === "next_controller_turn" ? { dueOwnerTurnsTaken: player.turnsTaken + 1 } : {}),
        type: action.action,
        ownerId: playerId,
        cardUid: source.uid,
        sourceName: source.name,
        destination: action.destination,
        resetDamage: Boolean(action.resetDamage),
        standby: Boolean(action.standby),
        sleep: Boolean(action.sleep)
      });
    } else if (action.type === "increase_memory_limit" && action.target === "source_controller") {
      player.permanentMemory += amount;
      player.memory += amount;
      queueMemoryLimitIncreasePrompt(state, playerId, source.name);
    } else if (action.type === "recover_damage" && action.target === "self_user") {
      const before = player.fortressStr;
      player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + amount);
      addLog(state, `${source.name}: 自分ユーザーを${player.fortressStr - before}回復。`, "effect");
    } else if (action.type === "recover_damage" && action.target === "enemy_user") {
      const opponent = state.players[enemyId];
      const before = opponent.fortressStr;
      opponent.fortressStr = Math.min(opponent.user.maxStr, opponent.fortressStr + amount);
      addLog(state, `${source.name}: 相手ユーザーを${opponent.fortressStr - before}回復。`, "effect");
    } else if (action.type === "discard" && action.target === "own_hand_all") {
      const discarded = player.hand.splice(0);
      for (const discardedCard of discarded) moveCardToTrash(state, playerId, discardedCard, source.name);
      if (action.recordAs) runtime.records[action.recordAs] = discarded.length;
      addLog(state, `${source.name}: 手札${discarded.length}枚を捨てた。`, "effect");
    } else if (action.type === "discard" && action.target === "selected_cards") {
      let discarded = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const index = player.hand.findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        moveCardToTrash(state, playerId, player.hand.splice(index, 1)[0], source.name);
        discarded += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = discarded;
      if (!discarded) return false;
      addLog(state, `${source.name}: 選択した手札${discarded}枚を捨てた。`, "effect");
    } else if (action.type === "discard" && action.target === "random_enemy_hand") {
      const enemy = state.players[enemyId];
      let discarded = 0;
      for (let index = 0; index < Number(action.count ?? 1) && enemy.hand.length; index += 1) {
        const randomIndex = Math.floor(state.rng() * enemy.hand.length);
        moveCardToTrash(state, enemyId, enemy.hand.splice(randomIndex, 1)[0], source.name);
        discarded += 1;
      }
      addLog(state, `${source.name}: 相手手札をランダムに${discarded}枚捨てた。`, "effect");
    } else if (action.type === "destroy" && action.target === "selected_enemy_area_card") {
      destroyCard(state, enemyId, targetUid, { source: source.name });
    } else if (action.type === "destroy" && action.target === "selected_own_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) destroyCard(state, playerId, target.uid, { source: source.name });
    } else if (action.type === "destroy" && action.target === "selected_own_area_card") {
      const location = findCard(state, targetUid);
      if (action.recordAs && location?.playerId === playerId && ["front", "back"].includes(location.zoneName)) {
        queueRuntimeDestructionContinuation(state, targetUid, {
          playerId,
          sourceId: source.id,
          sourceUid: source.uid,
          sourceName: source.name,
          sourceRuntime: source.runtimeTargetClass ? { runtimeTargetClass: source.runtimeTargetClass } : {},
          recordAs: action.recordAs,
          remainingActions: actions.slice(actionIndex + 1),
          runtime
        });
        destroyCard(state, playerId, targetUid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) });
        return true;
      }
      const destroyed = location?.playerId === playerId && ["front", "back"].includes(location.zoneName)
        ? destroyCard(state, playerId, targetUid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) })
        : false;
      if (action.recordAs) runtime.records[action.recordAs] = destroyed ? 1 : 0;
    } else if (action.type === "destroy" && action.target === "source") {
      if (!destroyCard(state, playerId, source.uid, { source: `${source.name}の効果`, suppressReplacement: Boolean(action.suppressReplacement) })) return false;
    } else if (action.type === "destroy" && action.target === "activation_target") {
      const uid = runtime.records?.activation_target_uid ?? targetUid;
      const location = findCard(state, uid);
      if (!location || (action.owner === "enemy" && location.playerId === playerId)
        || (action.zones?.includes("area") && !["front", "back"].includes(location.zoneName))) return false;
      const category = location.card.category;
      const destroyed = destroyCard(state, location.playerId, uid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) });
      if (action.recordAs) runtime.records[action.recordAs] = destroyed ? 1 : 0;
      if (destroyed && action.recordCategoryAs) runtime.records[action.recordCategoryAs] = category;
    } else if (action.type === "destroy" && action.target === "selected_own_registry_cards") {
      let destroyed = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const index = player.registry.findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        moveCardToTrash(state, playerId, player.registry.splice(index, 1)[0], source.name);
        destroyed += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = destroyed;
    } else if (action.type === "remove_components" && action.target === "selected_user_or_card") {
      if (String(targetUid).endsWith("-fortress")) {
        const targetPlayer = state.players[String(targetUid).startsWith("player-") ? "player" : "ai"];
        targetPlayer.counters = {};
        targetPlayer.timedModifiers = [];
      } else {
        const target = findCard(state, targetUid)?.card;
        if (target) clearComponents(target);
      }
    } else if (action.type === "sleep" && action.target === "enemy_ob_all") {
      for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)) {
        setCardSleeping(state, enemyId, target);
      }
    } else if (action.type === "add_counter" && action.target === "enemy_user") {
      const target = state.players[enemyId];
      target.counters ??= {};
      target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + amount;
      if (action.counter === "madness") resolveMadnessChecks(state, enemyId);
    } else if (action.type === "add_counter" && action.target === "selected_enemy_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) {
        if (action.counter === "load") target.load = Number(target.load ?? 0) + amount;
        else {
          target.counters ??= {};
          target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + amount;
        }
      }
    } else if (action.type === "move_all" && action.source === "own_hand" && action.destination === "registry") {
      const moved = player.hand.splice(0);
      for (const card of moved) {
        player.registry.push(card);
        emitRegistryInstalled(state, playerId, card, source.name);
      }
    } else if (action.type === "move_event_cards" && action.destination === "ban") {
      banGeneratedCards(state, runtime.records?.eventCardUids ?? [], source.name);
      if (action.recordAs) runtime.records[action.recordAs] = moved.length;
    } else if (action.type === "move_all" && action.source === "recorded_player_trash" && action.destination === "recorded_player_deck") {
      const target = state.players[runtime.records?.[action.playerRecord]];
      if (!target) return false;
      const moved = target.trash.filter((card) => !action.excludeSource || card.uid !== source.uid);
      target.trash = target.trash.filter((card) => action.excludeSource && card.uid === source.uid);
      target.deck.push(...moved);
      if (action.shuffleAfter) target.deck = shuffle(target.deck, state.rng);
    } else if (action.type === "move" && action.target === "selected_cards") {
      let moved = 0;
      let blockedByFullArea = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const location = findCard(state, uid);
        if (!location || location.playerId !== playerId || location.zoneName !== action.source) continue;
        if (["front", "back"].includes(action.source) && ["front", "back"].includes(action.destination)) {
          // 移動先が埋まっている時は移動だけ不発にして、後続の処理(生成など)は続ける
          if (!placementResult(player, action.destination).ok) { blockedByFullArea += 1; continue; }
          if (moveCardByEffect(state, playerId, uid, action.destination, source.name)) moved += 1;
          continue;
        }
        if (["area", "back"].includes(action.destination)) {
          const zone = action.destination === "back"
            ? "back"
            : player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
          const placed = placeCardByEffect(state, {
            sourceOwnerId: playerId, controllerId: playerId, sourceZone: action.source, targetZone: zone, cardUid: uid,
            sourceName: source.name, placementMode: action.forced ? "forced-effect" : "normal",
            onPlaced: (card) => { card.summoningSick = zone === "front"; card.faceDown = Boolean(action.asScript); }
          });
          if (placed.status === "placed") moved += 1;
          // 強制配置が上限で入らなかった時はルール破壊で処理済み(ゴミ箱へ)。巻き戻さずに先へ進める
          else if (placed.status === "failed-placement") blockedByFullArea += 1;
          continue;
        }
        if (action.destination === "drag") {
          state.pending = { type: "access-drag-place", playerId, sourceName: source.name, queue: [uid], sourceUid: uid,
            ...(continuationMeta.triggerItemId ? { triggerItemId: continuationMeta.triggerItemId } : {}) };
          moved += 1;
          continue;
        }
        if (action.destination === "registry") {
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (index < 0) continue;
          const [card] = player[action.source].splice(index, 1);
          if (["front", "back"].includes(action.source)) revealMountedCode(player[action.source], index, card, playerId, action.source);
          card.faceDown = Boolean(action.faceDown);
          player.registry.push(card);
          if (["front", "back"].includes(action.source)) distributeLayeredFollowers(state, card, "registry", source.name);
          if (!card.faceDown) emitRegistryInstalled(state, playerId, card, source.name);
          moved += 1;
        }
        if (action.destination === "hand") {
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (index < 0) continue;
          const [card] = player[action.source].splice(index, 1);
          if (["front", "back"].includes(action.source)) revealMountedCode(player[action.source], index, card, playerId, action.source);
          player.hand.push(card);
          if (["front", "back"].includes(action.source)) distributeLayeredFollowers(state, card, "hand", source.name);
          moved += 1;
        }
        if (action.destination === "bottom_layer_of_recorded_host") {
          const recorded = runtime.records?.[action.hostRecord];
          const hostUid = Array.isArray(recorded) ? recorded[0] : recorded;
          const host = findCard(state, hostUid)?.card;
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (!host || index < 0) continue;
          const [layer] = player[action.source].splice(index, 1);
          layer.layerRole = "layered";
          host.mounted.unshift(layer);
          moved += 1;
        }
      }
      if (!moved && blockedByFullArea) addLog(state, `${source.name}: 移動先エリアが埋まっているため移動できない。`, "effect");
      else if (!moved) return false;
      else addLog(state, `${source.name}: 選択した${moved}枚を${action.destination === "registry" ? "レジストリ" : "エリア"}へ移動。`, "effect");
    } else if (action.type === "move" && action.target === "source") {
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      if (!moveCardByEffect(state, playerId, source.uid, destination, source.name)) return false;
    } else if (action.type === "move" && action.target === "activation_target") {
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      const uid = runtime.records?.activation_target_uid ?? targetUid;
      const location = findCard(state, uid);
      const controllerId = location?.playerId;
      if (!controllerId || (action.owner === "enemy" && controllerId === playerId) || (action.source !== "area" && location.zoneName !== action.source)) return false;
      if (action.controllerRecord) runtime.records[action.controllerRecord] = controllerId;
      if (action.sourceZoneRecord) runtime.records[action.sourceZoneRecord] = location.zoneName;
      if (!moveCardByEffect(state, controllerId, uid, destination, source.name)) return false;
    } else if (action.type === "move" && action.target === "recorded_cards") {
      const recorded = runtime.records?.[action.recordKey];
      const uid = Array.isArray(recorded) ? recorded[0] : recorded;
      const location = findCard(state, uid);
      if (!location || location.zoneName !== action.source) return false;
      const controller = state.players[location.playerId];
      const beneficiaryId = location.card.owner ?? location.playerId;
      const index = controller[action.source].findIndex((card) => card.uid === uid);
      if (index < 0) return false;
      if (action.destination === "hand") {
        controller.hand.push(...controller[action.source].splice(index, 1));
      } else if (action.destination === "back") {
        if (!placementResult(controller, "back").ok) return false;
        const [moved] = controller[action.source].splice(index, 1);
        if (placeByMode(state, location.playerId, moved, { zone: "back", mode: "normal", from: action.source, source: source.name }) !== "placed") return false;
        triggerMoved(state, location.playerId, moved, action.source, "back");
      } else return false;
      if (action.beneficiaryRecord) runtime.records[action.beneficiaryRecord] = beneficiaryId;
    } else if (action.type === "move" && action.target === "random_each_player" && action.destination === "ban") {
      for (const targetPlayer of Object.values(state.players)) {
        const pool = action.source === "hand_and_area"
          ? ["hand", "front", "back"].flatMap((zoneName) => targetPlayer[zoneName].map((card) => ({ zoneName, card })))
          : [];
        if (!pool.length) continue;
        const chosen = pool[Math.floor(state.rng() * pool.length)];
        const index = targetPlayer[chosen.zoneName].findIndex((card) => card.uid === chosen.card.uid);
        if (index < 0) continue;
        const [card] = targetPlayer[chosen.zoneName].splice(index, 1);
        if (["front", "back"].includes(chosen.zoneName)) revealMountedCode(targetPlayer[chosen.zoneName], index, card, card.controller ?? card.owner, chosen.zoneName);
        targetPlayer.ban.push(card);
        if (["front", "back"].includes(chosen.zoneName)) distributeLayeredFollowers(state, card, "ban", source.name);
      }
    } else if (action.type === "swap" && action.target === "selected_own_area_cards") {
      const selected = [...new Set(targetUids.length ? targetUids : [targetUid].filter(Boolean))]
        .map((uid) => findCard(state, uid))
        .filter((entry) => entry?.playerId === playerId && ["front", "back"].includes(entry.zoneName) && isObCard(entry.card));
      if (selected.length !== 2) return false;
      const [first, second] = selected;
      const firstIndex = player[first.zoneName].findIndex((card) => card.uid === first.card.uid);
      const secondIndex = player[second.zoneName].findIndex((card) => card.uid === second.card.uid);
      swapBoardSlots(first.card, second.card);
      player[first.zoneName][firstIndex] = second.card;
      player[second.zoneName][secondIndex] = first.card;
      triggerMoved(state, playerId, first.card, first.zoneName, second.zoneName);
      triggerMoved(state, playerId, second.card, second.zoneName, first.zoneName);
      addLog(state, `${source.name}: ${first.card.name}と${second.card.name}の位置を交換。`, "effect");
    } else if (action.type === "mill" && action.target === "own_deck_top" && action.destination === "trash") {
      let recorded = 0;
      for (let index = 0; index < amount && player.deck.length; index += 1) {
        const card = player.deck.pop();
        const outcome = card.trashReplacement === "ban" || card.replaceTrashWithBan
          ? (player.ban.push(card), "ban")
          : moveCardToTrash(state, playerId, card, source.name);
        if (outcome === "trash" && runtimeSpecMatchesCard(card, action.recordFilter, null, { state, playerId, source, runtime })) recorded += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = recorded;
    } else if (action.type === "shuffle" && action.target === "own_deck") {
      player.deck = shuffle(player.deck, state.rng);
    } else if (action.type === "access") {
      openRuntimeAccessSelection(state, playerId, source, action, null, null, continuationMeta);
    } else if (action.type === "decode") {
      return openRuntimeDecodeSelection(state, playerId, source, action, runtime);
    } else if (action.type === "choose_effect") {
      return openRuntimeChoiceSelection(state, playerId, source, action, runtime);
    } else if (action.type === "modify_stats") {
      const runtimeSource = action.className ? { ...source, runtimeTargetClass: action.className } : source;
      for (const target of runtimeSpecTargets(state, playerId, runtimeSource, targetUid, action.target)) {
        const multiplier = action.perTargetMultiplier === "layer_count"
          ? Number(target.mounted?.length ?? 0)
          : action.multiplier ? Number(runtimeSpecValue(state, playerId, source, action.multiplier, runtime)) : 1;
        if (action.duration === "through_next_turn") {
          addTimedModifier(state, target, { ...action, atk: Number(action.atk ?? 0) * multiplier, str: Number(action.str ?? 0) * multiplier }, source.name);
        } else {
          const atkField = action.duration === "turn" ? "tempAtk" : "permanentAtk";
          const strField = action.duration === "turn" ? "tempStr" : "permanentStr";
          target[atkField] = Number(target[atkField] ?? 0) + Number(action.atk ?? 0) * multiplier;
          target[strField] = Number(target[strField] ?? 0) + Number(action.str ?? 0) * multiplier;
        }
      }
    } else if (action.type === "modify_execution_cost" && action.target === "selected_cards") {
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const target = findCard(state, uid)?.card;
        if (!target) continue;
        target.turnCostModifier = Number(target.turnCostModifier ?? 0) + amount;
      }
    } else if (action.type === "grant_keyword") {
      const runtimeSource = action.className ? { ...source, runtimeTargetClass: action.className } : source;
      for (const target of runtimeSpecTargets(state, playerId, runtimeSource, targetUid, action.target)) {
        target.grantedKeywords = [...new Set([...(target.grantedKeywords ?? []), action.keyword])];
        if (action.duration === "turn") target.keywordExpiries = { ...(target.keywordExpiries ?? {}), [action.keyword]: state.turnNumber };
        if (action.duration === "through_next_turn_end") target.keywordExpiries = { ...(target.keywordExpiries ?? {}), [action.keyword]: state.turnNumber + 1 };
      }
    } else if (action.type === "set_flag") {
      const value = runtimeSpecValue(state, playerId, source, action.value);
      if (action.target === "own_class_ob_all") {
        for (const target of runtimeSpecTargets(state, playerId, { ...source, runtimeTargetClass: action.className }, targetUid, action.target)) target[action.flag] = value;
      } else {
        const target = action.target === "enemy_player" ? state.players[enemyId] : source;
        target[action.flag] = value;
      }
    } else if (action.type === "move" && action.target === "deck_top" && action.destination === "registry") {
      for (let index = 0; index < Number(action.count ?? 1); index += 1) {
        const installed = player.deck.pop();
        if (!installed) break;
        player.registry.push(installed);
        emitRegistryInstalled(state, playerId, installed, source.name);
      }
    } else if (action.type === "generate") {
      const generated = [];
      const generatedPlayerId = action.playerRecord ? runtime.records?.[action.playerRecord] : playerId;
      const generatedPlayer = state.players[generatedPlayerId];
      if (!generatedPlayer) return false;
      const availableIds = action.cardIds ?? Array(Number(action.count ?? 1)).fill(action.cardId);
      const cardIds = action.randomOne
        ? [availableIds[Math.floor(state.rng() * availableIds.length)]]
        : availableIds;
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      for (let index = 0; index < cardIds.length; index += 1) {
        const card = action.factory === "punks_token"
          ? hydrateCard(createRuntimeToken(state.runtimeContext ?? null, generatedPlayerId, ++state.tokenSerial))
          : createVengeanceCard(state, cardIds[index], generatedPlayerId);
        generated.push(card);
        if (destination === "hand") {
          generatedPlayer.hand.push(card);
          continue;
        }
        if (destination === "execute") {
          generatedPlayer.hand.push(card);
          const zone = card.category === "Script"
            ? (generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front")
            : (generatedPlayer.front.length < generatedPlayer.user.frontLimit ? "front" : generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front");
          playCard(state, generatedPlayerId, card.uid, {
            zone, free: Boolean(action.free), force: Boolean(action.forced), ignoreColor: Boolean(action.free),
            placementCause: "effect", placementSource: source.name, placementMode: action.forced ? "forced-effect" : "normal"
          });
          continue;
        }
        const zone = ["front", "back"].includes(destination)
          ? destination
          : generatedPlayer.front.length < generatedPlayer.user.frontLimit ? "front" : generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front";
        card.summoningSick = zone === "front";
        const placed = placeByMode(state, generatedPlayerId, card, { zone, from: "generated", source: source.name });
        if (placed === "placed" && action.factory === "punks_token") emitEffectPlacement(state, generatedPlayerId, card, zone, source.name);
      }
      if (destination === "hand" && generated.length) emitCardsGenerated(state, generatedPlayerId, generated, source.name);
    } else if (action.type === "consume_layers" && action.target === "selected_cards") {
      const selected = new Set(targetUids.length ? targetUids : [targetUid].filter(Boolean));
      let consumed = 0;
      for (const owner of Object.values(state.players)) {
        for (const { host, layer } of ownLayerEntries(owner)) {
          if (!selected.has(layer.uid)) continue;
          const index = host.mounted.findIndex((candidate) => candidate.uid === layer.uid);
          if (index < 0) continue;
          const [removed] = host.mounted.splice(index, 1);
          moveCardToTrash(state, removed.owner ?? playerId, removed, `${source.name}のレイヤー消費`);
          consumed += 1;
        }
      }
      if (action.recordAs) runtime.records[action.recordAs] = consumed;
      addLog(state, `${source.name}: レイヤー${consumed}枚を消費。`, "effect");
    } else if (action.type === "repeat_select_move") {
      const remaining = Number(runtimeSpecValue(state, playerId, source, action.count, runtime));
      if (remaining > 0) return openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining);
    } else throw new Error(`Unsupported card runtime operation: ${action.type}`);
  }
  return true;
}

export function executeCardRuntimeSpec(state, phase, playerId, source, { targetUid = null, continuationMeta = {} } = {}) {
  const spec = cardRuntimeSpec(source.id, phase);
  if (!spec) return false;
  return executeRuntimeActions(state, playerId, source, spec.actions, { targetUid, continuationMeta });
}

function openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining) {
  const candidates = runtimeSelectionCandidates(state, playerId, source, { selector: action.selector }, runtime);
  if (!candidates.length || remaining <= 0) return true;
  const request = createSelectionRequest({
    mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${action.label ?? "カードを選択"}（残り${remaining}回）`, message: source.text,
    continuation: {
      type: "runtime-repeat-select-move", playerId, sourceId: source.id, sourceUid: source.uid,
      sourceName: source.name, selector: action.selector, sourceZone: action.source,
      destination: action.destination, remaining, runtime, label: action.label
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function resumeDestroyLkiFollowUp(state, targetUid) {
  const followUp = state.destroyLkiFollowUps?.[targetUid];
  if (!followUp) return false;
  delete state.destroyLkiFollowUps[targetUid];
  const player = state.players[followUp.playerId];
  if (followUp.type === "std157") {
    const candidates = player.hand.filter((card) => isObCard(card) && card.color === "黒" && Number(card.cost ?? 0) <= followUp.x);
    if (!candidates.length) return true;
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: `元メモリ${followUp.x}以下の黒Obを無償配置`, message: followUp.sourceName,
      continuation: { type: "std157-place", playerId: followUp.playerId, sourceName: followUp.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = player.trash.filter(isObCard);
  if (!candidates.length) return true;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 0, maximum: candidates.length,
    budget: followUp.x, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    label: `元メモリ合計${followUp.x}以下でObを任意サルベージ`, message: followUp.sourceName,
    continuation: { type: "std162-salvage", playerId: followUp.playerId, sourceName: followUp.sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
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

function banGeneratedCards(state, uids, source) {
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

function damageCardMatchesFilter(card, filter) {
  if (filter === "any") return true;
  if (!card || !filter) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.effectText === "none" && !hasNoEffectText(card)) return false;
  if (filter.classesAny && !filter.classesAny.some((className) => hasClass(card, className))) return false;
  return true;
}

function damageModifierApplies(spec, provider, providerPlayerId, event) {
  if (spec.providerScope !== "own_area") return false;
  if (spec.direction === "dealt" && event.sourcePlayerId !== providerPlayerId) return false;
  if (spec.direction === "received" && event.victimPlayerId !== providerPlayerId) return false;
  if (spec.damageKind !== "all" && spec.damageKind !== event.kind) return false;
  if (spec.destination !== "all" && spec.destination !== event.destination) return false;
  if (spec.sourceFilter === "provider") {
    if (event.sourceCard?.uid !== provider.uid) return false;
  } else if (!damageCardMatchesFilter(event.sourceCard, spec.sourceFilter)) return false;
  if (spec.targetFilter === "provider" && event.victimCard?.uid !== provider.uid) return false;
  if (spec.activeTurn !== undefined && spec.activeTurn !== event.turnNumber) return false;
  return true;
}

function grantDamageModifier(card, modifier) {
  card.damageModifiers ??= [];
  card.damageModifiers.push({
    providerScope: "own_area",
    sourceFilter: "any",
    targetFilter: "provider",
    destination: "card",
    ...modifier
  });
}

export function clearDamageModifiers(card, duration) {
  if (!card.damageModifiers) return;
  card.damageModifiers = card.damageModifiers.filter((modifier) => modifier.duration !== duration);
}

export function applyDamageModifiers(state, sourcePlayerId, sourceCard, victimPlayerId, amount, {
  kind = "effect",
  destination = "card",
  victimCard = null
} = {}) {
  let value = Number(amount);
  const event = { sourcePlayerId, sourceCard, victimPlayerId, victimCard, kind, destination, turnNumber: state.turnNumber };
  const applicable = [];
  for (const [providerPlayerId, player] of Object.entries(state.players)) {
    for (const provider of [...player.front, ...player.back]) {
      for (const spec of [...damageModifierSpecsFor(provider.id), ...(provider.damageModifiers ?? [])]) {
        if (!damageModifierApplies(spec, provider, providerPlayerId, event)) continue;
        applicable.push(spec);
      }
    }
  }
  for (const spec of applicable.filter((item) => item.operation === "add")) value += Number(spec.amount ?? 0);
  const sourcePlayer = state.players[sourcePlayerId];
  const doOrIsntDamageDown = sourcePlayer.user.abilityKey === "do_or_isnt" && isObCard(sourceCard)
    && [...sourcePlayer.front, ...sourcePlayer.back].filter(isObCard).length >= 5;
  const beforeDoOrIsnt = value;
  if (doOrIsntDamageDown) value -= 1;
  for (const spec of applicable.filter((item) => item.operation === "cap_max")) value = Math.min(value, Number(spec.amount ?? 0));
  for (const spec of applicable.filter((item) => item.operation === "set")) value = Number(spec.amount ?? 0);
  const unsupported = applicable.find((item) => !["add", "cap_max", "set"].includes(item.operation));
  if (unsupported) throw new Error(`Unsupported damage modifier operation: ${unsupported.operation ?? "(missing)"}`);
  const finalValue = Math.max(0, value);
  if (doOrIsntDamageDown) {
    let withoutAbility = beforeDoOrIsnt;
    for (const spec of applicable.filter((item) => item.operation === "cap_max")) withoutAbility = Math.min(withoutAbility, Number(spec.amount ?? 0));
    for (const spec of applicable.filter((item) => item.operation === "set")) withoutAbility = Number(spec.amount ?? 0);
    withoutAbility = Math.max(0, withoutAbility);
    if (finalValue < withoutAbility) emitUserAbilityFeedback(state, "do_or_isnt", sourcePlayerId, victimPlayerId, {
      branch: "five-plus-damage-down", before: withoutAbility, after: finalValue, anchorCardUid: sourceCard?.uid, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: victimPlayerId, metric: "damage" }, before: withoutAbility, after: finalValue }]
    });
  }
  return finalValue;
}

export function getMaxMemory(player) {
  const appliedOnce = new Set();
  let modifier = 0;
  for (const provider of player.registry ?? []) {
    for (const spec of playerValueModifierSpecsFor(provider.id)) {
      if (spec.value !== "max_memory" || spec.providerZone !== "registry" || (spec.faceUp && provider.faceDown)) continue;
      if (spec.aggregation === "once" && appliedOnce.has(spec)) continue;
      modifier += Number(spec.amount ?? 0);
      if (spec.aggregation === "once") appliedOnce.add(spec);
    }
  }
  return player.baseMemory + player.permanentMemory + modifier + (player.turboActive ? 2 : 0);
}

function executionCostModifierValue(card, state, playerId) {
  const appliedOnce = new Set();
  let modifier = 0;
  for (const spec of executionCostModifierSpecsFor(card.id).filter((item) => item.target === "source")) {
    if (spec.multiplier?.expression === "own_area_distinct_name_count") {
      const player = state.players[playerId];
      const count = new Set([...player.front, ...player.back]
        .filter((item) => runtimeSpecMatchesCard(item, spec.multiplier.filter))
        .map((item) => item.name)).size;
      modifier += Number(spec.amount ?? 0) * count;
    }
  }
  for (const [providerPlayerId, providerPlayer] of Object.entries(state.players)) {
    const zones = { registry: providerPlayer.registry ?? [], area: [...providerPlayer.front, ...providerPlayer.back] };
    for (const [zone, providers] of Object.entries(zones)) {
      for (const provider of providers) {
        for (const spec of executionCostModifierSpecsFor(provider.id)) {
          if (spec.providerZone !== zone || (spec.faceUp && provider.faceDown)) continue;
          if (spec.providerOwner === "self" && providerPlayerId !== playerId) continue;
          if (spec.providerOwner === "enemy" && providerPlayerId === playerId) continue;
          if (spec.condition?.expression === "target_name_in_controller_trash"
            && !state.players[playerId].trash.some((item) => item.name === card.name)) continue;
          if (spec.aggregation === "once" && appliedOnce.has(spec)) continue;
          modifier += Number(spec.amount ?? 0);
          if (spec.aggregation === "once") appliedOnce.add(spec);
        }
      }
    }
  }
  return modifier;
}

export function executionCost(card, state = null, playerId = null) {
  if (card.revealedExecutionCost === 1) return 1;
  let modifier = Number(card.turnCostModifier ?? 0) - Number(card.costReductionThisTurn ?? 0);
  if (state && playerId) {
    modifier += executionCostModifierValue(card, state, playerId);
    const player = state.players[playerId];
    if (player.user.abilityKey === "watching_you") modifier += ["Sp", "Script"].includes(card.category) ? -1 : isObCard(card) || card.category === "Code" ? 1 : 0;
    if (player.user.abilityKey === "do_or_isnt" && isObCard(card)
      && player.firstObExecutionTurn !== state.turnNumber
      && [...player.front, ...player.back].filter(isObCard).length <= 2) modifier -= 1;
  }
  return Math.max(0, Number(card.cost ?? 0) + modifier);
}

export function visibleHandExecutionPayment(state, playerId, card, viewerId = null) {
  const viewer = viewerId ?? state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
  const printed = Math.max(0, Number(card.cost ?? 0));
  if (playerId !== viewer) return null;
  const value = card.category === "Script" ? 0 : executionCost(card, state, playerId);
  return { printed, value, delta: value - printed };
}

function settleStd048MandatoryPlacement(state, pending, placed) {
  const continuation = state.mandatoryDrawContinuation;
  if (pending?.type !== "std048-draw-place" || !continuation
    || continuation.type !== "std048-mandatory-draw"
    || continuation.sourceUid !== pending.sourceUid
    || continuation.placementOutcome !== "pending") return false;
  continuation.placementOutcome = placed ? "placed" : "failed";
  return resumeMandatoryDrawContinuation(state);
}

export function beginStd048MandatoryDraw(state, playerId, card, remainingRuleDraws) {
  card.dragFree = true;
  state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "STD-048-mandatory-draw", source: card.uid,
    playerId, status: "awaiting-choice"
  };
  state.mandatoryDrawContinuation = {
    type: "std048-mandatory-draw", playerId, sourceUid: card.uid, sourceName: card.name,
    remainingRuleDraws, placementOutcome: "pending", ruleDrawDone: remainingRuleDraws === 0, successEffectDone: false
  };
  state.pending = {
    type: "std048-draw-place", playerId, sourceName: card.name,
    queue: [card.uid], sourceUid: card.uid
  };
  addLog(state, `${card.name}: ルールによる最初のドローで引いた。配置先を選択。`, "effect");
  return true;
}

export function ownLayerEntries(player) {
  return ["front", "back"].flatMap((zoneName) => player[zoneName].flatMap((host) =>
    (host.mounted ?? []).map((layer) => ({ zoneName, host, layer }))));
}

export function beginSourceLayerSelection(state, playerId, source, count, continuation, candidateUids = null) {
  normalizeMountedStack(source);
  const allowed = candidateUids ? new Set(candidateUids) : null;
  const layers = source.mounted.filter((layer) => !allowed || allowed.has(layer.uid));
  if (layers.length < count) return false;
  const labels = Object.fromEntries(layers.map((layer) => {
    const index = source.mounted.findIndex((candidate) => candidate.uid === layer.uid);
    return [layer.uid, `レイヤー${index + 1}: ${layer.name}`];
  }));
  const request = createSelectionRequest({
    mode: count === 1 ? "single" : "exact",
    candidates: layers.map((layer) => layer.uid),
    count,
    minimum: count,
    maximum: count,
    candidateLabels: labels,
    label: `${source.name}: 消費するレイヤーを${count}枚選択`,
    message: source.text,
    continuation
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function consumeSelectedSourceLayers(state, playerId, source, selectedUids, reason) {
  normalizeMountedStack(source);
  const unique = [...new Set(selectedUids ?? [])];
  const layers = unique.map((uid) => source.mounted.find((layer) => layer.uid === uid));
  if (layers.some((layer) => !layer) || layers.length !== unique.length) return null;
  for (const layer of layers) {
    const index = source.mounted.findIndex((candidate) => candidate.uid === layer.uid);
    source.mounted.splice(index, 1);
    moveCardToTrash(state, layer.owner ?? playerId, layer, reason);
  }
  addLog(state, `${source.name}: ${layers.map((layer) => `「${layer.name}」`).join("、")}をレイヤーから消費。`, "effect");
  return layers;
}

export function placementCostCandidates(state, spec) {
  if (!spec?.selection) return [];
  const { zones = [], faceUp = false, namePrefix = "" } = spec.selection;
  return Object.entries(state.players).flatMap(([ownerId, owner]) => zones.flatMap((zoneName) =>
    (owner[zoneName] ?? [])
      .filter((card) => (!faceUp || card.faceDown !== true) && card.name.startsWith(namePrefix))
      .map((card) => ({ ownerId, zoneName, card }))
  ));
}

function finishPlacementCostBatch(state, paid) {
  const batch = state.placementCostBatch;
  if (!batch) return false;
  state.placementCostBatch = null;
  if (!paid) {
    addLog(state, `${batch.sourceName}: 必要な破壊コストをすべて支払えなかったため設置しない。`, "effect");
    return true;
  }
  const source = state.players[batch.playerId].hand.find((card) => card.uid === batch.sourceUid);
  if (!source) return fail(state, `${batch.sourceName}: 発動元が手札を離れたため設置できない。`, false);
  const resume = batch.options?.requestedSlot != null ? playCardCore : playCard;
  return resume(state, batch.playerId, batch.sourceUid, { ...batch.options, placementCostPermit: STD121_PLACEMENT_PERMIT });
}

export function continuePlacementCostBatch(state) {
  const batch = state.placementCostBatch;
  if (!batch || batch.currentUid || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction) return false;
  if (batch.failed) return finishPlacementCostBatch(state, false);
  if (!batch.queue.length) return finishPlacementCostBatch(state, batch.paidCount === batch.requiredCount);
  const uid = batch.queue.shift();
  const location = findCard(state, uid);
  if (!location || !["front", "back"].includes(location.zoneName) || location.card.faceDown === true || !location.card.name.startsWith(batch.namePrefix)) {
    batch.failed = true;
    return finishPlacementCostBatch(state, false);
  }
  batch.currentUid = uid;
  const started = destroyCard(state, location.playerId, uid, { source: `${batch.sourceName}の設置コスト` });
  if (!started && batch.currentUid === uid) {
    batch.currentUid = null;
    batch.failed = true;
    return finishPlacementCostBatch(state, false);
  }
  return true;
}

function settlePlacementCostDestruction(state, uid, destroyed) {
  const batch = state.placementCostBatch;
  if (!batch || batch.currentUid !== uid) return false;
  batch.currentUid = null;
  if (destroyed) batch.paidCount += 1;
  else batch.failed = true;
  return true;
}

export function magazineExecutionCandidates(state, playerId) {
  const player = state.players[playerId];
  return player.hand.filter((card) => {
    if (card.category !== "Sp" || !hasKeyword(card, "MAGAZINE")) return false;
    if (spellNeedsTarget(card) && getEffectTargets(state, otherPlayer(playerId), card).length === 0) return false;
    const amount = Number(keywordValue(card, "MAGAZINE") ?? 0);
    const reduction = ownLayerEntries(player).length >= amount ? amount : 0;
    return canPlayCard(state, playerId, card, { allowOffTurn: true, executionCostReduction: reduction }).ok;
  });
}

export function beginSztb094Counter(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid)?.card;
  if (!source || source.id !== "SZTB-094" || source.sleep) return false;
  const candidates = magazineExecutionCandidates(state, playerId);
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / メモリ${executionCost(item, state, playerId)}`])),
    label: `${source.name}: [弾倉]Spを実行`, message: "選んだ場合、これをスリープして選択したSpを実行する。選ばず確定も可能。",
    continuation: { type: "sztb094-counter-select", playerId, sourceUid } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function resumeDeferredDestruction(state) {
  if (state.prompt || !state.deferredDestruction) return false;
  const deferred = state.deferredDestruction;
  state.deferredDestruction = null;
  const resolved = destroyCard(state, deferred.ownerId, deferred.uid, { source: deferred.source, suppressReplacement: deferred.suppressReplacement, suppressTrashScriptWindow: true, piercing: Boolean(deferred.piercing) });
  continueDeferredSpellCleanup(state);
  return resolved;
}

export function matchesModuleFilter(card, filter = {}) {
  if (filter.color && card.color !== filter.color) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.excludeCategory && matchesCardCategory(card, filter.excludeCategory)) return false;
  if (filter.className && !hasClass(card, filter.className)) return false;
  if (filter.originalMemoryMaximum !== undefined && Number(card.cost ?? Infinity) > filter.originalMemoryMaximum) return false;
  return true;
}

export function takeViewedFromDeck(player, uids) {
  const viewed = uids.map((uid) => player.deck.find((card) => card.uid === uid)).filter(Boolean);
  for (let index = player.deck.length - 1; index >= 0; index -= 1) {
    if (uids.includes(player.deck[index].uid)) player.deck.splice(index, 1);
  }
  return viewed;
}

export function moveRemainderToDeck(player, cards, position) {
  if (position === "bottom") player.deck.unshift(...cards);
  else player.deck.push(...cards);
}

export function beginDynamicSelectionModule(state, playerId, card, continuation = {}) {
  const module = card.compiled.selectionModules?.find((entry) => entry.module === "dynamic_threshold_selection");
  if (!module) return false;
  const player = state.players[playerId];
  const valueFrom = module.selection.filter.originalMemoryMaximumFrom;
  const maximum = valueFrom === "self_registry_count" ? player.registry.length : 0;
  const zone = player[module.selection.source] ?? [];
  const candidates = zone.filter((candidate) => Number(candidate.cost ?? Infinity) <= maximum && matchesModuleFilter(candidate, module.selection.filter));
  if (!candidates.length) return false;
  const request = selectionRequestFromSpec(createSelectionSpec({ candidates: candidates.map((candidate) => candidate.uid), minimum: 1, maximum: 1 }), {
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, `${candidate.name} / ${candidate.cost}`])), label: `X=${maximum}以下から選択`, message: card.text,
    continuation: { type: "selection-module-dynamic", playerId, sourceUid: card.uid, sourceName: card.name, module, ...continuation }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function beginAllocationSelectionModule(state, playerId, card) {
  const module = card.compiled.selectionModules?.find((entry) => entry.module === "select_allocate_follow_up");
  if (!module) return false;
  const targetPlayerId = module.selection.owner === "opponent" ? otherPlayer(playerId) : playerId;
  const targetPlayer = state.players[targetPlayerId];
  const zones = module.selection.source === "area" ? ["front", "back"] : [module.selection.source];
  const candidates = zones.flatMap((zone) => targetPlayer[zone] ?? []).filter((candidate) => matchesModuleFilter(candidate, module.selection));
  const request = selectionRequestFromSpec(createSelectionSpec({ candidates: candidates.map((candidate) => candidate.uid), minimum: 0, maximum: candidates.length }), {
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])), label: "割り振る対象を任意選択", message: card.text,
    continuation: { type: "selection-module-allocation-targets", playerId, sourceUid: card.uid, sourceName: card.name, module }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function resolveImperialRandomInstall(state, playerId, sourceName) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const sources = [
    { name: "hand", cards: opponent.hand },
    { name: "area", cards: [...opponent.front, ...opponent.back] },
    { name: "trash", cards: opponent.trash },
    { name: "deck", cards: opponent.deck }
  ];
  let moved = 0;
  for (const source of sources) {
    if (!source.cards.length) continue;
    const chosen = source.cards[Math.floor(state.rng() * source.cards.length)];
    let zone = source.name;
    if (zone === "area") zone = opponent.front.some((card) => card.uid === chosen.uid) ? "front" : "back";
    const index = opponent[zone].findIndex((card) => card.uid === chosen.uid);
    if (index < 0) continue;
    const [card] = opponent[zone].splice(index, 1);
    opponent.registry.push(card);
    moved += 1;
    emitGameEvent(state, { type: "card_moved", playerId: opponentId, ownerId: card.owner ?? opponentId,
      cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, from: zone, to: "registry", source: sourceName });
  }
  opponent.deck = shuffle(opponent.deck, state.rng);
  addLog(state, `${sourceName}: 相手の手札・エリア・ゴミ箱・山札から各1枚までをレジストリへインストール（${moved}枚）。`, "effect");
  return moved;
}

export function beginSztb094Access(state, playerId, sourceName, { resumeTurnEndActiveId = null } = {}) {
  const player = state.players[playerId];
  const candidates = player.deck.filter((candidate) => isArmsBandCard(candidate) && !isObCard(candidate));
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((candidate) => candidate.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])),
    label: `${sourceName}: Ob以外のアームズバンド・カードへアクセス`, message: "選んだカードを手札へ加え、山札をシャッフルする。",
    continuation: { type: "access-to-hand", playerId, sourceName, ...(resumeTurnEndActiveId ? { resumeTurnEndActiveId } : {}) } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
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

function placeCardByEffect(state, { sourceOwnerId, controllerId, cardUid, sourceZone, targetZone, sourceName = "効果配置", placementMode = "forced-effect", placementCause = "effect", underUid = null, onPlaced = null } = {}) {
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

function continueStd163Choices(state, continuation, remaining) {
  if (remaining <= 0) return true;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
    label: `残り${remaining}回：①または②`, message: continuation.sourceName,
    continuation: { type: "std163-choice", playerId: continuation.playerId, sourceName: continuation.sourceName, remaining }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

function scheduleStd142TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function scheduleStd141TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function isStd141TurnEndSource(state, ownerId, uid) {
  const source = findCard(state, uid);
  return Boolean(source && source.playerId === ownerId && source.zoneName === "back"
    && source.card.id === "STD-141" && source.card.residentActive);
}

function takeStd141TurnEndSource(state, ownerId, uid) {
  const queue = state.std141TurnEndQueue;
  if (!queue) return false;
  queue.entries[ownerId] = (queue.entries[ownerId] ?? []).filter((entryUid) => entryUid !== uid);
  queue.nextOwnerId = otherPlayer(ownerId);
  return isStd141TurnEndSource(state, ownerId, uid);
}

function openStd141EffectChoice(state, ownerId, activeId, sourceUid) {
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

function std142PublicSacredTreeTargets(state) {
  return Object.entries(state.players).flatMap(([ownerId, owner]) =>
    ["front", "back"].flatMap((zoneName) => owner[zoneName]
      .filter((card) => card.faceDown !== true && card.name.includes("聖樹"))
      .map((card) => ({ ownerId, zoneName, card })))
  );
}

function openStd142DestroySelection(state, continuation) {
  const candidates = std142PublicSacredTreeTargets(state);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map(({ card }) => card.uid),
    count: candidates.length,
    minimum: 0,
    maximum: candidates.length,
    candidateLabels: Object.fromEntries(candidates.map(({ ownerId, card }) => [card.uid, `${state.players[ownerId].name ?? ownerId}: ${card.name}`])),
    label: "破壊処理を行う表向きの「聖樹」カードを任意選択",
    message: continuation.sourceName,
    continuation: {
      type: "std142-destroy",
      playerId: continuation.playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function continueStd142DestroyResolution(state) {
  const batch = state.std142DestroyBatch;
  if (!batch) return false;
  const next = batch.queue.shift();
  if (next) {
    const location = findCard(state, next);
    if (!location || location.card.faceDown === true || !location.card.name.includes("聖樹")) {
      return continueStd142DestroyResolution(state);
    }
    (state.std142DestructionContinuations ??= {})[next] = { type: "target" };
    destroyCard(state, location.playerId, next, { source: batch.sourceName });
    return true;
  }
  const player = state.players[batch.playerId];
  const candidates = player.trash.filter((card) => card.category === "Script");
  const maximum = Math.min(batch.destroyedCount, candidates.length);
  const { activeId, playerId, sourceName } = batch;
  delete state.std142DestroyBatch;
  if (maximum <= 0) return scheduleStd142TurnEndResume(state, activeId);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum: 0,
    maximum,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `Scriptを${maximum}枚までサルベージ`,
    message: sourceName,
    continuation: { type: "std142-salvage", playerId, activeId, sourceName }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function settleStd142DestructionContinuation(state, uid, destroyed) {
  const continuation = state.std142DestructionContinuations?.[uid];
  if (!continuation) return false;
  delete state.std142DestructionContinuations[uid];
  if (!Object.keys(state.std142DestructionContinuations).length) delete state.std142DestructionContinuations;
  if (continuation.type === "source") {
    if (destroyed) return openStd142DestroySelection(state, continuation);
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "target" && state.std142DestroyBatch) {
    if (destroyed) state.std142DestroyBatch.destroyedCount += 1;
    return continueStd142DestroyResolution(state);
  }
  return false;
}

function resolveCardSelectionCore(state, continuation, result) {
  const playerId = continuation.playerId ?? "player";
  const player = state.players[playerId];
  if (continuation.type === "placement-cost-destroy") {
    const source = player.hand.find((card) => card.uid === continuation.sourceUid && card.id === "STD-121");
    const spec = source ? cardPlacementCostSpec(source.id) : null;
    const candidates = placementCostCandidates(state, spec);
    const byUid = new Map(candidates.map((entry) => [entry.card.uid, entry]));
    const selectedUids = [...new Set(result.selected ?? [])];
    const selected = selectedUids.map((uid) => byUid.get(uid)).filter(Boolean);
    const requiredCount = Number(continuation.requiredCount ?? 0);
    const distinctNames = new Set(selected.map(({ card }) => card.name));
    const fullBack = !placementResult(player, "back", { mode: continuation.options?.placementMode ?? "normal" }).ok;
    const freesOwnBack = selected.some(({ ownerId, zoneName }) => ownerId === playerId && zoneName === "back");
    if (!source || selectedUids.length !== requiredCount || selected.length !== requiredCount
      || (continuation.distinctBy === "name" && distinctNames.size !== requiredCount)
      || (fullBack && !freesOwnBack)) return false;
    state.pending = null;
    state.placementCostBatch = {
      type: "destroy-to-place", playerId, sourceUid: source.uid, sourceName: source.name,
      requiredCount, namePrefix: continuation.namePrefix, queue: selectedUids,
      paidCount: 0, currentUid: null, failed: false, options: continuation.options ?? {}
    };
    return continuePlacementCostBatch(state);
  }
  if (continuation.type === "runtime-repeat-select-move") {
    const source = runtimeSourceFromContinuation(state, continuation);
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    const candidates = runtimeSelectionCandidates(state, playerId, source, { selector: continuation.selector }, runtime);
    const selected = candidates.find((card) => card.uid === result.selected?.[0]);
    if (!selected) return false;
    const sourceZone = player[continuation.sourceZone];
    const index = sourceZone?.findIndex((card) => card.uid === selected.uid) ?? -1;
    if (index < 0 || continuation.destination !== "hand") return false;
    player.hand.push(...sourceZone.splice(index, 1));
    state.pending = null;
    return openRuntimeRepeatSelectMove(state, playerId, source, {
      selector: continuation.selector, source: continuation.sourceZone,
      destination: continuation.destination, label: continuation.label
    }, runtime, Number(continuation.remaining) - 1);
  }
  if (continuation.type === "runtime-zone-choice") {
    if (!continuation.options.includes(result.scope)) return false;
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    if (continuation.sourceZoneRecord) runtime.records[continuation.sourceZoneRecord] = continuation.sourceZone;
    if (continuation.destinationRecord) runtime.records[continuation.destinationRecord] = result.scope;
    state.pending = null;
    return executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), continuation.afterActions, { runtime });
  }
  if (continuation.type === "runtime-effect-choice") {
    const choice = continuation.choices.find((item) => item.label === result.choice);
    if (!choice) return false;
    state.pending = null;
    return executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), choice.actions, { runtime: continuation.runtime });
  }
  if (continuation.type === "runtime-decode") {
    const decoded = [];
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index >= 0) decoded.push(player.trash.splice(index, 1)[0]);
    }
    if (!decoded.length) {
      state.pending = null;
      return true;
    }
    state.pending = {
      type: "decode-place",
      playerId,
      sourceName: continuation.sourceName,
      queue: decoded.map((card) => card.uid),
      cards: decoded,
      sourceUid: decoded[0].uid,
      enterSleep: continuation.enterSleep,
      destroyAtTurnEnd: continuation.destroyAtTurnEnd,
      destroyTurnPlayerId: continuation.destroyTurnPlayerId
    };
    return true;
  }
  if (continuation.type === "destruction-replacement-choice") {
    state.pending = null;
    if (result.scope === "[バックアップ]で置換") return destroyCard(state, playerId, continuation.targetUid, { source: continuation.source, replacementChoice: "backup" });
    if (result.scope === "STD-099で置換ログイン") {
      const candidates = [...player.front, ...player.back].filter((card) => card.uid !== continuation.targetUid && hasClass(card, "レッドパンクス"));
      const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
        label: "STD-099の追加レイヤー素材", message: "レッドパンクスを1枚以上選択。",
        continuation: { type: "std099-replacement-materials", playerId, targetUid: continuation.targetUid, sourceUid: continuation.std099Uid, source: continuation.source } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    return destroyCard(state, playerId, continuation.targetUid, { source: continuation.source, suppressReplacement: true, piercing: Boolean(continuation.piercing) });
  }
  if (continuation.type === "std099-replacement-materials") {
    const targetLocation = findCard(state, continuation.targetUid);
    const sourceIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
    if (!targetLocation || sourceIndex < 0 || result.selected.length < 1) return false;
    const [sourceCard] = player.hand.splice(sourceIndex, 1);
    const targetZone = player[targetLocation.zoneName];
    const [targetCard] = targetZone.splice(targetZone.findIndex((card) => card.uid === continuation.targetUid), 1);
    const materials = [];
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (!location || location.playerId !== playerId || !["front", "back"].includes(location.zoneName) || !hasClass(location.card, "レッドパンクス")) continue;
      const materialZone = player[location.zoneName];
      materials.push(...materialZone.splice(materialZone.findIndex((card) => card.uid === uid), 1));
    }
    targetCard.layerRole = "layered";
    for (const material of materials) material.layerRole = "layered";
    sourceCard.mounted = [targetCard, ...materials];
    sourceCard.sleep = false;
    sourceCard.summoningSick = true;
    inheritBoardSlot(sourceCard, targetCard, { controllerId: playerId, zoneName: targetLocation.zoneName });
    player[targetLocation.zoneName].push(sourceCard);
    state.pending = null;
    emitGameEvent(state, { type: "card_destroyed", playerId, ownerId: playerId, cardUid: targetCard.uid, cardId: targetCard.id,
      cardName: targetCard.name, category: targetCard.category, from: targetLocation.zoneName, to: "layer", source: continuation.source, replaced: true });
    resolveLogin(state, playerId, sourceCard);
    addLog(state, `${sourceCard.name}: ${targetCard.name}の破壊を置換し、レイヤーとして無償ログイン。`, "effect");
    settleDestructionContinuations(state, targetCard.uid, true);
    resumeDestroyLkiFollowUp(state, targetCard.uid);
    continuePlacementCostBatch(state);
    return true;
  }
  if (["std157-destroy", "std162-destroy"].includes(continuation.type)) {
    const location = findCard(state, result.selected[0]);
    if (!location || location.playerId !== playerId) return false;
    const target = location.card;
    const x = continuation.type === "std157-destroy" ? Number(target.cost ?? 0) : Number(target.str ?? 0);
    (state.destroyLkiFollowUps ??= {})[target.uid] = { type: continuation.type === "std157-destroy" ? "std157" : "std162", playerId, sourceName: continuation.sourceName, x };
    state.pending = null;
    const resolved = destroyCard(state, playerId, target.uid, { source: continuation.sourceName });
    if (!state.pending) resumeDestroyLkiFollowUp(state, target.uid);
    return resolved;
  }
  if (continuation.type === "std157-place") {
    state.pending = null;
    const zone = player.front.length < player.user.frontLimit ? "front" : "back";
    // エリアが埋まっていて置けなかった時はルール破壊で処理済み。効果全体は巻き戻さない
    return ["placed", "failed-placement"].includes(placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: result.selected[0], sourceName: continuation.sourceName,
      onPlaced: (card) => { card.summoningSick = zone === "front"; }
    }).status);
  }
  if (continuation.type === "std162-salvage") {
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid && isObCard(card));
      if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
    }
    state.pending = null;
    addLog(state, `${continuation.sourceName}: Ob${result.selected.length}枚をサルベージ。`, "effect");
    return true;
  }
  if (continuation.type === "play-card-oc") {
    const pay = result.scope === `+${continuation.amount}払う`;
    state.pending = null;
    // An OC choice resumes the same effect; it is not a new UI command.
    const resume = continuation.options?.requestedSlot != null ? playCardCore : playCard;
    const resolved = resume(state, playerId, continuation.sourceUid, { ...continuation.options, ocDecision: pay });
    if (!continuation.options?.registryExecution) return resolved;
    const source = findCard(state, continuation.sourceUid);
    if (!resolved || !source || !["front", "back", "mounted", "trash"].includes(source.zoneName)) {
      const handIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
      if (handIndex >= 0) player.registry.splice(continuation.options.registryOriginIndex ?? player.registry.length, 0, ...player.hand.splice(handIndex, 1));
      return false;
    }
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: source.card.owner ?? playerId,
      cardUid: source.card.uid, cardId: source.card.id, cardName: source.card.name, category: source.card.category, reason: "execute" });
    return true;
  }
  if (continuation.type === "sztb-jacket-place") {
    const zone = result.scope === "バック" ? "back" : "front";
    const jacket = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "SZTB-091", playerId, ++state.tokenSerial + 900));
    emitCardsGenerated(state, playerId, [jacket], continuation.sourceName);
    placeByMode(state, playerId, jacket, { zone, mode: "forced-effect", from: "generated", source: continuation.sourceName });
    state.pending = null;
    return true;
  }
  if (continuation.type === "sztb095-sp-replacement") {
    state.pending = null;
    return finalizeDeferredSpellCleanup(state, { replacementHostUid: result.selected[0] ?? null });
  }
  if (continuation.type === "sztb097-choice") {
    if (result.scope === "①アームズバンドObへアクセス") {
      const candidates = player.deck.filter(isArmsBandOb);
      if (!candidates.length) { state.pending = null; return true; }
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "アームズバンドObへアクセス", message: continuation.sourceName,
        continuation: { type: "sztb097-access", playerId, sourceName: continuation.sourceName } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    const candidates = [...player.front, ...player.back].filter(isObCard);
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: candidates.length, minimum: 0, maximum: candidates.length,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / ATK ${cardAtk(state, playerId, item)}`])),
      label: "合計ATKへ加える自分Obを任意選択", message: "0枚で確定した場合、後続処理は行わない。",
      continuation: { type: "sztb097-atk-sum", playerId, sourceName: continuation.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "sztb097-access") {
    const index = player.deck.findIndex((item) => item.uid === result.selected[0] && isArmsBandOb(item));
    if (index < 0) return false;
    const [accessed] = player.deck.splice(index, 1);
    player.deck = shuffle(player.deck, state.rng);
    player.hand.push(accessed);
    state.pending = null;
    addLog(state, `${continuation.sourceName}: ${accessed.name}へアクセスし手札へ加えた。`, "effect");
    return true;
  }
  if (continuation.type === "sztb097-atk-sum") {
    const selected = result.selected.map((uid) => findCard(state, uid)).filter((entry) => entry?.playerId === playerId
      && ["front", "back"].includes(entry.zoneName) && isObCard(entry.card));
    if (!selected.length) {
      if (state.deferredSpellCleanup) state.deferredSpellCleanup.postEffectDone = true;
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 0体を選択したため、後続処理を行わず終了。`, "effect");
      return true;
    }
    const totalAtk = selected.reduce((sum, entry) => sum + Math.max(0, cardAtk(state, playerId, entry.card)), 0);
    const targets = Object.entries(state.players).flatMap(([ownerId, owner]) => [...owner.front, ...owner.back]
      .filter((item) => isObCard(item) && cardCurrentStr(state, ownerId, item) <= totalAtk)
      .map((item) => ({ ownerId, card: item })));
    if (!targets.length) return false;
    const request = createSelectionRequest({ mode: "single", candidates: targets.map((entry) => entry.card.uid), count: 1,
      candidateLabels: Object.fromEntries(targets.map((entry) => [entry.card.uid, `${entry.card.name} / STR ${cardCurrentStr(state, entry.ownerId, entry.card)}`])),
      label: `合計ATK ${totalAtk} 以下のObを破壊`, message: continuation.sourceName,
      continuation: { type: "sztb097-destroy", playerId, sourceName: continuation.sourceName, totalAtk } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "sztb097-destroy") {
    const target = findCard(state, result.selected[0]);
    if (!target || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)
      || cardCurrentStr(state, target.playerId, target.card) > continuation.totalAtk) return false;
    state.pending = null;
    destroyCard(state, target.playerId, target.card.uid, { source: continuation.sourceName });
    return true;
  }
  if (continuation.type === "sztb094-counter-select") {
    const source = findCard(state, continuation.sourceUid)?.card;
    const spell = player.hand.find((item) => item.uid === result.selected[0] && item.category === "Sp" && hasKeyword(item, "MAGAZINE"));
    if (!spell) { state.pending = null; return true; }
    if (!source || source.sleep) return false;
    source.sleep = true;
    if (spellNeedsTarget(spell)) {
      const targets = getEffectTargets(state, otherPlayer(playerId), spell);
      if (!targets.length) { source.sleep = false; state.pending = null; return false; }
      const request = createSelectionRequest({ mode: "single", candidates: targets.map((item) => item.uid), count: 1,
        candidateLabels: Object.fromEntries(targets.map((item) => [item.uid, item.name])), label: `${spell.name}: 対象を選択`, message: spell.text,
        continuation: { type: "sztb094-counter-target", playerId, spellUid: spell.uid, sourceUid: source.uid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    state.pending = null;
    return playCard(state, playerId, spell.uid, { allowOffTurn: true });
  }
  if (continuation.type === "sztb094-counter-target") {
    state.pending = null;
    return playCard(state, playerId, continuation.spellUid, { targetUid: result.selected[0], allowOffTurn: true });
  }
  if (continuation.type === "play-card-magazine-confirm") {
    const useMagazine = result.scope === "使用する";
    state.pending = null;
    if (!useMagazine) {
      const resolved = playCard(state, playerId, continuation.sourceUid, { ...continuation.options, magazineDecision: false });
      if (!continuation.options?.registryExecution) return resolved;
      const source = findCard(state, continuation.sourceUid);
      if (!resolved || !source || !["front", "back", "mounted", "trash"].includes(source.zoneName)) {
        const handIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
        if (handIndex >= 0) player.registry.splice(continuation.options.registryOriginIndex ?? player.registry.length, 0, ...player.hand.splice(handIndex, 1));
        return false;
      }
      emitGameEvent(state, { type: "registry_left", playerId, ownerId: source.card.owner ?? playerId,
        cardUid: source.card.uid, cardId: source.card.id, cardName: source.card.name, category: source.card.category, reason: "execute" });
      return true;
    }
    const layers = ownLayerEntries(player);
    const request = createSelectionRequest({
      mode: "exact",
      candidates: layers.map(({ layer }) => layer.uid),
      count: continuation.amount,
      minimum: continuation.amount,
      maximum: continuation.amount,
      candidateLabels: Object.fromEntries(layers.map(({ host, layer }) => [layer.uid, `${host.name} / ${layer.name}`])),
      label: `弾倉：消費するレイヤーを${continuation.amount}枚選択`,
      message: `選択したレイヤーを消費し、実行メモリを${continuation.amount}軽減する。`,
      continuation: { type: "play-card-magazine-layers", playerId, sourceUid: continuation.sourceUid, amount: continuation.amount, options: continuation.options }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "play-card-magazine-layers") {
    state.pending = null;
    const resolved = playCard(state, playerId, continuation.sourceUid, {
      ...continuation.options,
      magazineDecision: true,
      magazineLayerUids: result.selected
    });
    if (!continuation.options?.registryExecution) return resolved;
    const source = findCard(state, continuation.sourceUid);
    if (!resolved || !source || !["front", "back", "mounted", "trash"].includes(source.zoneName)) {
      const handIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
      if (handIndex >= 0) player.registry.splice(continuation.options.registryOriginIndex ?? player.registry.length, 0, ...player.hand.splice(handIndex, 1));
      return false;
    }
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: source.card.owner ?? playerId,
      cardUid: source.card.uid, cardId: source.card.id, cardName: source.card.name, category: source.card.category, reason: "execute" });
    return true;
  }
  if (continuation.type === "activate-std203-response") {
    state.pending = null;
    return activateStd203Response(state, playerId, continuation.cardUid, result.selected, continuation.responseEvent);
  }
  if (continuation.type === "std141-choice") {
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
  if (continuation.type === "std141-turn-end-source") {
    state.pending = null;
    const sourceUid = result.selected[0];
    if (!sourceUid || !takeStd141TurnEndSource(state, playerId, sourceUid)) return scheduleStd141TurnEndResume(state, continuation.activeId);
    return openStd141EffectChoice(state, playerId, continuation.activeId, sourceUid);
  }
  if (continuation.type === "std140-update-choice") {
    if (result.scope === "①戦闘保護") {
      const candidates = [...player.front, ...player.back].filter(isObCard);
      if (!candidates.length) { state.pending = null; return true; }
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        label: "-2/0し戦闘ダメージを無効にするOb", message: continuation.sourceName,
        continuation: { type: "std140-protect", playerId, sourceName: continuation.sourceName } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    const candidates = player.trash.filter((card) => card.name.includes("聖樹") && card.name !== "聖樹枝(セフィラリンク)");
    if (!candidates.length) { state.pending = null; return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "サルベージする『聖樹枝』以外の聖樹カード", message: continuation.sourceName,
      continuation: { type: "salvage-selected", playerId, sourceName: continuation.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std223-ambush-choice") {
    const attacker = findCard(state, continuation.attackerUid)?.card;
    if (!attacker) return false;
    attacker.skipStd223Ambush = true;
    if (result.scope === "起動しない") { state.pending = null; return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.attackTargetUid); }
    const candidates = Object.values(state.players).flatMap((current) => [...current.front, ...current.back]).filter(isObCard);
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "異次元ショットで3ダメージを与えるOb", message: continuation.sourceName,
      continuation: { type: "std223-ambush-target", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName,
        attackerPlayerId: continuation.attackerPlayerId, attackerUid: attacker.uid, attackTargetUid: continuation.attackTargetUid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std223-ambush-target") {
    const sourceIndex = player.registry.findIndex((card) => card.uid === continuation.sourceUid && card.id === "STD-223");
    const target = findCard(state, result.selected[0]);
    if (sourceIndex < 0 || !target || !isObCard(target.card) || player.memory < 2) return false;
    const [source] = player.registry.splice(sourceIndex, 1);
    player.memory -= 2;
    moveCardToTrash(state, playerId, source, source.name);
    state.lastDamageOutcome = null;
    dealCardDamage(state, target.playerId, target.card.uid, 3, source.name, { sourcePlayerId: playerId });
    if (state.lastDamageOutcome?.destructionDetermined) drawCards(state, playerId, 1);
    state.pending = null;
    const attacker = findCard(state, continuation.attackerUid)?.card;
    if (!attacker) return true;
    // 3ダメージで破壊されたObの「自分Obが破壊された時」Script確認などが開いている間は、確認が済んでから宣言し直す。
    // 3ダメージを受けた攻撃者自身が[バックアップ]や破壊で攻撃できなくなった場合は、宣言した攻撃がそこで終わる(回答は拒否しない)。
    continueAttackAfterCost(state, continuation.attackerPlayerId, attacker.uid, continuation.attackTargetUid);
    return true;
  }
  if (continuation.type === "std140-protect") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) {
      addTimedModifier(state, target, { atk: -2, str: 0, duration: "turn" }, continuation.sourceName);
      grantDamageModifier(target, {
        direction: "received", damageKind: "battle", operation: "set", amount: 0,
        duration: "turn", activeTurn: state.turnNumber
      });
    }
    state.pending = null;
    return true;
  }
  if (continuation.type === "std141-access") {
    const selected = result.selected.map((uid) => player.deck.find((card) => card.uid === uid)).filter(Boolean);
    player.deck = player.deck.filter((card) => !result.selected.includes(card.uid));
    player.deck = shuffle(player.deck, state.rng);
    const request = createSelectionRequest({ mode: "single", candidates: selected.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(selected.map((card) => [card.uid, card.name])), label: continuation.installOne ? "設置する1枚" : "手札に加える1枚", message: continuation.sourceName,
      continuation: { type: "std141-access-destination", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, selected, installOne: continuation.installOne, activeId: continuation.activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std141-access-destination") {
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
  if (continuation.type === "std141-place-yellow-ob") {
    const index = player.hand.findIndex((card) => card.uid === result.selected[0] && isObCard(card) && card.color === "黄");
    if (index >= 0) {
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const [card] = player.hand.splice(index, 1); card.summoningSick = true;
      if (placeByMode(state, playerId, card, { zone, from: "hand", source: continuation.sourceName }) === "placed") emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
    }
    state.pending = null;
    return scheduleStd141TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "relog-layer-discount") {
    const useLayerDiscount = result.scope === "レイヤー1枚を破棄して1メモリ";
    state.pending = null;
    if (!useLayerDiscount) return relogCard(state, playerId, continuation.sourceUid, continuation.targetZone, { useLayerDiscount: false, requestedSlot: continuation.requestedSlot ?? null, baseUid: continuation.baseUid ?? null });
    const source = findCard(state, continuation.sourceUid)?.card;
    return source ? beginSourceLayerSelection(state, playerId, source, 1, {
      type: "relog-layer-select", playerId, sourceUid: source.uid, targetZone: continuation.targetZone, requestedSlot: continuation.requestedSlot ?? null,
      baseUid: continuation.baseUid ?? null
    }) : false;
  }
  if (continuation.type === "relog-layer-select") {
    state.pending = null;
    return relogCard(state, playerId, continuation.sourceUid, continuation.targetZone, {
      useLayerDiscount: true,
      layerUid: result.selected[0],
      requestedSlot: continuation.requestedSlot ?? null,
      baseUid: continuation.baseUid ?? null
    });
  }
  if (continuation.type === "q3-layer-attack-choice") {
    const source = findCard(state, continuation.sourceUid)?.card;
    state.pending = null;
    if (!source) return false;
    const layerCost = source.id === "STD-238" ? 2 : 1;
    const use = result.scope === `レイヤー${layerCost}枚を破棄して起動`;
    if (!use) {
      source.skipQ3LayerAttackChoice = true;
      return attack(state, playerId, source.uid, continuation.targetUid);
    }
    let candidateUids = null;
    if (source.id === "STD-102") {
      normalizeMountedStack(source);
      candidateUids = source.mounted.filter((layer) => {
        const candidates = [...player.trash, ...(isObCard(layer) || layer.category === "Code" ? [layer] : [])]
          .filter((card, index, cards) => (isObCard(card) || card.category === "Code") && cards.findIndex((item) => item.uid === card.uid) === index);
        const feasibility = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
          exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])) });
        return isSelectionRequestFeasible(feasibility);
      }).map((layer) => layer.uid);
    }
    return beginSourceLayerSelection(state, playerId, source, layerCost, {
      type: "q3-layer-attack-pay", playerId, sourceUid: source.uid, targetUid: continuation.targetUid
    }, candidateUids);
  }
  if (continuation.type === "q3-layer-attack-pay") {
    const source = findCard(state, continuation.sourceUid)?.card;
    state.pending = null;
    if (!source) return false;
    const layerCost = source.id === "STD-238" ? 2 : 1;
    const layers = consumeSelectedSourceLayers(state, playerId, source, result.selected, `${source.name}のレイヤーコスト`);
    if (!layers || layers.length !== layerCost) return false;
    source.skipQ3LayerAttackChoice = true;
    if (source.id === "STD-238") {
      source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
      return continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid, { standbyAfter: true });
    }
    if (source.id === "STD-096") return continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid, { standbyAfter: true });
    const candidates = player.trash.filter((card) => isObCard(card) || card.category === "Code");
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
      exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
      label: "元々のメモリ合計ちょうど2を選択", message: source.text,
      continuation: { type: "std102-place", playerId, sourceUid: source.uid, targetUid: continuation.targetUid } });
    if (!isSelectionRequestFeasible(request)) return false;
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std097-battle-choice") {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    if (result.scope === "レイヤー1枚を破棄して①を起動") {
      return beginSourceLayerSelection(state, sourceLocation.playerId, source, 1, {
        type: "std097-battle-pay", playerId: sourceLocation.playerId, sourceUid: source.uid,
        attackerPlayerId: continuation.attackerPlayerId, attackerUid: continuation.attackerUid, targetUid: continuation.targetUid
      });
    }
    source.skipStd097BattleChoice = true;
    return attack(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
  }
  if (continuation.type === "std097-battle-pay") {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    const layers = consumeSelectedSourceLayers(state, sourceLocation.playerId, source, result.selected, `${source.name}のレイヤーコスト`);
    if (!layers || layers.length !== 1) return false;
    source.skipStd097BattleChoice = true;
    grantDamageModifier(source, {
      direction: "received", damageKind: "battle", operation: "cap_max", amount: 1, duration: "battle"
    });
    return continueAttackAfterCost(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
  }
  if (continuation.type === "std085-layer-pay") {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    const layers = consumeSelectedSourceLayers(state, sourceLocation.playerId, source, result.selected, `${source.name}の攻撃時コスト`);
    if (!layers || layers.length !== 1) return false;
    source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
    if (source.mounted.length + 1 <= 1) {
      destroyCard(state, sourceLocation.playerId, source.uid, { source: `${source.name}のレイヤー閾値判定` });
      return true;
    }
    source.skipStd085LayerCost = true;
    return continueAttackAfterCost(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
  }
  if (continuation.type === "std102-place") {
    const source = findCard(state, continuation.sourceUid)?.card;
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index < 0) continue;
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const [card] = player.trash.splice(index, 1);
      placeByMode(state, playerId, card, { zone, from: "trash", source: continuation.sourceName, suppressScriptWindow: true });
    }
    state.pending = null;
    if (source && source.mounted.length === 0) destroyCard(state, playerId, source.uid, { source: `${source.name}のレイヤー閾値` });
    const sourceLocation = source ? findCard(state, source.uid) : null;
    return sourceLocation && ["front", "back"].includes(sourceLocation.zoneName)
      ? continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid)
      : true;
  }
  if (continuation.type === "std164-choice") {
    const opponentId = otherPlayer(playerId);
    const opponent = state.players[opponentId];
    state.pending = null;
    if (result.choice.startsWith("①")) {
      if (opponent.hand.length) moveCardToTrash(state, opponentId, opponent.hand.shift(), continuation.sourceName ?? "手札破棄");
      resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
      return true;
    }
    const candidates = [...opponent.front, ...opponent.back].filter(isObCard);
    if (!candidates.length) {
      resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
      return true;
    }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "毒カウンターを置く相手Ob", message: continuation.sourceName,
      continuation: { type: "std164-poison", playerId, sourceName: continuation.sourceName, triggerItemId: continuation.triggerItemId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std164-poison") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) {
      target.counters ??= {};
      target.counters.poison = Number(target.counters.poison ?? 0) + 2;
    }
    state.pending = null;
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "q2-access-hand") {
    const index = player.deck.findIndex((item) => item.uid === result.selected[0]);
    if (index < 0) return false;
    const [card] = player.deck.splice(index, 1);
    player.deck = shuffle(player.deck, state.rng);
    player.hand.push(card);
    state.pending = null;
    if (continuation.triggerItemId) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "access-to-deck-top") {
    const index = player.deck.findIndex((item) => item.uid === result.selected[0]);
    if (index < 0) return false;
    const [card] = player.deck.splice(index, 1);
    player.deck = shuffle(player.deck, state.rng);
    player.deck.push(card);
    state.pending = null;
    addLog(state, `${continuation.sourceName}: ${card.name}へアクセスし山札の上へ。`, "effect");
    return true;
  }
  if (continuation.type === "std212-respawn-count") {
    const count = Math.min(continuation.maximum, Math.max(0, Number(result.scope) || 0));
    let generated = 0;
    for (let index = 0; index < count; index += 1) {
      const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const card = createVengeanceCard(state, "STD-189", playerId);
      card.summoningSick = zoneName === "front";
      if (placeByMode(state, playerId, card, { zone: zoneName, from: "generated", source: continuation.sourceName }) === "placed") generated += 1;
    }
    addLog(state, `${continuation.sourceName}: 破壊されたOb ${continuation.maximum}枚を参照し、「ドールズ」を${generated}枚生成。`, "effect");
    state.pending = null;
    return completeTurnAfterDelayedEffects(state, continuation.activeId);
  }
  if (continuation.type === "activate-std142-effect1") {
    state.pending = null;
    return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
  }
  if (continuation.type === "std163-destroy") {
    for (const uid of result.selected) destroyCard(state, playerId, uid, { source: continuation.sourceName });
    state.pending = null;
    if (!result.selected.length) return true;
    const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
      label: `残り${result.selected.length}回：①または②`, message: continuation.sourceName,
      continuation: { type: "std163-choice", playerId, sourceName: continuation.sourceName, remaining: result.selected.length }
    });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (continuation.type === "std163-choice") {
    state.pending = null;
    if (result.choice.startsWith("①")) {
      drawCards(state, playerId, 2);
      return continueStd163Choices(state, continuation, continuation.remaining - 1);
    }
    const opponentId = otherPlayer(playerId);
    const candidates = [...state.players[opponentId].front, ...state.players[opponentId].back].filter(isObCard);
    if (!candidates.length) return continueStd163Choices(state, continuation, continuation.remaining - 1);
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "3ダメージを与える相手Ob", message: continuation.sourceName,
      continuation: { ...continuation, type: "std163-damage", remaining: continuation.remaining - 1 } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std163-damage") {
    const target = findCard(state, result.selected[0]);
    if (target) dealCardDamage(state, target.playerId, target.card.uid, 3, continuation.sourceName, { sourcePlayerId: playerId });
    state.pending = null;
    return continueStd163Choices(state, continuation, continuation.remaining);
  }
  if (continuation.type === "std142-turn-end-choice") {
    state.pending = null;
    if (!result.selected.length) {
      return scheduleStd142TurnEndResume(state, continuation.activeId);
    }
    const source = findCard(state, continuation.sourceUid);
    if (!source || source.card.faceDown === true || source.card.id !== "STD-142") {
      return scheduleStd142TurnEndResume(state, continuation.activeId);
    }
    (state.std142DestructionContinuations ??= {})[source.card.uid] = {
      type: "source",
      playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName
    };
    destroyCard(state, source.playerId, source.card.uid, { source: `${source.card.name}の②起動コスト` });
    return true;
  }
  if (continuation.type === "std142-destroy") {
    state.pending = null;
    if (!result.selected.length) return scheduleStd142TurnEndResume(state, continuation.activeId);
    state.std142DestroyBatch = {
      playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName,
      queue: [...result.selected],
      destroyedCount: 0
    };
    return continueStd142DestroyResolution(state);
  }
  if (continuation.type === "std142-salvage") {
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
    }
    state.pending = null;
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "user-savage-salvage") {
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
    }
    state.pending = null;
    state.skipSavageTurnEnd = true;
    addLog(state, result.selected.length
      ? `*ゴミ箱は空にならない*: ${result.selected.length}枚をサルベージ。`
      : "*ゴミ箱は空にならない*: サルベージしない。", "effect");
    if (result.selected.length) emitUserAbilityFeedback(state, "trash_never_empty", continuation.ownerPlayerId ?? continuation.playerId, continuation.playerId, {
      branch: "salvaged", amount: result.selected.length, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: continuation.playerId, zone: "trash" }, to: { kind: "zone_count", playerId: continuation.playerId, zone: "hand" }, count: result.selected.length }]
    });
    return endTurn(state);
  }
  if (continuation.type === "selection-module-look") {
    const viewed = takeViewedFromDeck(player, continuation.viewedUids);
    const chosenUid = result.selected[0];
    const chosenIndex = viewed.findIndex((card) => card.uid === chosenUid);
    if (chosenIndex >= 0) {
      const [chosen] = viewed.splice(chosenIndex, 1);
      player[continuation.module.selection.destination]?.push(chosen);
      addLog(state, `${continuation.sourceName}: 見たカードから「${chosen.name}」を${continuation.module.selection.destination === "hand" ? "手札" : continuation.module.selection.destination}へ。`, "effect");
    }
    moveRemainderToDeck(player, viewed, continuation.module.remainder.position);
    state.pending = null;
    return true;
  }
  if (continuation.type === "selection-module-access-move") {
    const source = player[continuation.source];
    const index = source.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [selected] = source.splice(index, 1);
    if (continuation.shuffleRemaining) player.deck = shuffle(player.deck, state.rng);
    player[continuation.destination].push(selected);
    addLog(state, `${continuation.sourceName}: 「${selected.name}」へアクセスしレジストリへインストール。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "selection-module-dynamic") {
    const module = continuation.module;
    const source = player[module.selection.source];
    const index = source.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [selected] = source.splice(index, 1);
    player.hand.push(selected);
    state.pending = null;
    const executed = playCard(state, playerId, selected.uid, { free: module.followUp?.executionCost === 0 });
    if (!executed) {
      const handIndex = player.hand.findIndex((card) => card.uid === selected.uid);
      if (handIndex >= 0) player.hand.splice(handIndex, 1);
      source.push(selected);
    }
    const attacker = findCard(state, continuation.sourceUid)?.card;
    if (continuation.resumeAttack && attacker) {
      attacker.skipDynamicSelectionAttackEffect = true;
      return attack(state, playerId, attacker.uid, continuation.targetUid);
    }
    return executed;
  }
  if (continuation.type === "selection-module-allocation-targets") {
    const source = findCard(state, continuation.sourceUid)?.card;
    if (!source) return false;
    const total = source.mounted.reduce((sum, layer) => sum + Number(layer.cost ?? 0), 0);
    if (!result.selected.length) {
      for (const layer of source.mounted.splice(0)) state.players[layer.owner ?? playerId].registry.push(layer);
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 対象0体。割り振りを飛ばし、レイヤーをレジストリへ。`, "effect");
      return true;
    }
    const allocationSpec = createAllocationSpec({ targets: result.selected, total, minimumPerTarget: 0, allowNoTargets: false });
    const request = selectionRequestFromSpec(allocationSpec, {
      candidateLabels: Object.fromEntries(result.selected.map((uid) => [uid, findCard(state, uid)?.card.name ?? uid])), label: `${total}ダメージを割り振る`, message: source.text,
      continuation: { type: "selection-module-allocation-resolve", playerId, sourceUid: source.uid, sourceName: source.name }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "selection-module-allocation-resolve") {
    const source = findCard(state, continuation.sourceUid)?.card;
    if (!source) return false;
    for (const [uid, amount] of Object.entries(result.allocation)) {
      if (amount > 0) {
        const target = findCard(state, uid);
        if (target) dealCardDamage(state, target.playerId, uid, amount, continuation.sourceName, { sourcePlayerId: playerId });
      }
    }
    for (const layer of source.mounted.splice(0)) state.players[layer.owner ?? playerId].registry.push(layer);
    state.pending = null;
    return true;
  }
  if (continuation.type === "runtime-action-selection") {
    const source = runtimeSourceFromContinuation(state, continuation);
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    const validTargets = new Set(runtimeSelectionCandidates(state, playerId, source, { selector: continuation.selector ?? {} }, runtime).map((card) => card.uid));
    const selected = [...new Set(result.selected ?? [])];
    if (selected.length < Number(continuation.minimum ?? 0)
      || selected.length > Number(continuation.maximum ?? selected.length)
      || selected.some((uid) => !validTargets.has(uid))) return false;
    state.pending = null;
    if (continuation.skipAfterActionsWhenEmpty && !selected.length) return true;
    if (continuation.recordAs) runtime.records[continuation.recordAs] = selected;
    const resolved = executeRuntimeActions(state, playerId, source, continuation.afterActions ?? [], {
      targetUid: selected[0] ?? null,
      targetUids: selected,
      runtime,
      continuationMeta: continuation.triggerItemId ? { triggerItemId: continuation.triggerItemId } : {}
    });
    if (continuation.resumeAttack) {
      const attacker = state.players[playerId].front.find((card) => card.uid === continuation.attackerUid);
      if (!attacker) return false;
      const declaredTargetLocation = findCard(state, continuation.targetUid);
      const declaredTargetExists = continuation.targetUid?.endsWith("-fortress")
        || Boolean(declaredTargetLocation && ["front", "back"].includes(declaredTargetLocation.zoneName));
      if (!declaredTargetExists && continuation.settleMissingTargetAsCompleted) {
        setCardSleeping(state, playerId, attacker);
        attacker.attackedThisTurn = true;
        addLog(state, `${attacker.name}の攻撃対象は攻撃前効果で破壊され、戦闘を終了。`, "effect");
        return true;
      }
      if (state.pending || state.prompt) {
        state.deferredAttack = { stage: "start", playerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
        return resolved;
      }
      attacker.skipRuntimeAttackEffect = true;
      return attack(state, playerId, attacker.uid, continuation.targetUid);
    }
    if (continuation.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return resolved;
  }
  if (continuation.type === "runtime-player-selection") {
    const selected = result.selected?.[0];
    if (!continuation.candidates.includes(selected)) return false;
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    if (continuation.recordAs) runtime.records[continuation.recordAs] = selected;
    state.pending = null;
    return executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), continuation.afterActions, { runtime });
  }
  if (continuation.type === "runtime-access-reference") {
    const source = runtimeSourceFromContinuation(state, continuation);
    const reference = player.hand.find((card) => card.uid === result.selected[0]);
    if (!reference) return false;
    if (continuation.action.referenceSelection?.reveal) reference.revealed = true;
    if (!openRuntimeAccessSelection(state, playerId, source, continuation.action, reference, reference.uid)) {
      reference.revealed = false;
      return false;
    }
    return true;
  }
  if (["access-to-hand", "access-drag", "access-distribute"].includes(continuation.type)) {
    const accessed = [];
    for (const uid of result.selected) {
      const index = player.deck.findIndex((card) => card.uid === uid);
      if (index >= 0) accessed.push(player.deck.splice(index, 1)[0]);
    }
    player.deck = shuffle(player.deck, state.rng);
    if (continuation.type === "access-distribute") {
      for (const [index, card] of accessed.entries()) {
        const destination = continuation.destinations?.[index] ?? "hand";
        if (destination === "trash") moveCardToTrash(state, playerId, card, continuation.sourceName ?? "アクセス");
        else player.hand.push(card);
      }
    } else {
      player.hand.push(...accessed);
    }
    if (continuation.revealSelected) {
      for (const card of accessed) card.revealed = true;
    }
    state.pending = continuation.type === "access-drag" && accessed.length ? {
      type: "access-drag-place", playerId, sourceName: continuation.sourceName,
      queue: accessed.map((card) => card.uid), sourceUid: accessed[0].uid, enterSleep: continuation.enterSleep
    } : null;
    if (continuation.revealedUid) {
      const revealed = player.hand.find((card) => card.uid === continuation.revealedUid);
      if (revealed) revealed.revealed = false;
    }
    if (!state.pending && continuation.afterActions?.length) {
      executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), continuation.afterActions, {
        targetUids: accessed.map((card) => card.uid),
        continuationMeta: continuation.triggerItemId ? { triggerItemId: continuation.triggerItemId } : {}
      });
    }
    const resultText = continuation.type === "access-drag"
      ? (accessed.length ? "。配置先を選択。" : "。対象なし。")
      : continuation.type === "access-distribute"
        ? "し、指定された領域へ移動。"
        : "し手札へ。";
    addLog(state, `${continuation.sourceName}: ${accessed.length}枚へアクセス${resultText}`, "effect");
    if (!state.pending && continuation.resumeTurnEndActiveId) state.resumeTurnEndAfterSelection = continuation.resumeTurnEndActiveId;
    if (continuation.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    if (!state.pending) openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "activate-runtime-additional-cost") {
    state.pending = null;
    return activateScript(state, playerId, continuation.scriptUid, { costUid: result.selected[0] });
  }
  if (continuation.type === "activate-std105") {
    state.pending = null;
    return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
  }
  if (continuation.type === "std165-login") {
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
  if (continuation.type === "trigger-selected-entity-action") {
    const uid = result.selected[0];
    const action = continuation.action;
    if (action?.type !== "add_counter" || action.target !== "selected_entity") return false;
    if (uid?.endsWith("-fortress")) {
      const targetId = uid.slice(0, -"-fortress".length);
      const target = state.players[targetId];
      if (!target) return false;
      target.load = Number(target.load ?? 0) + Number(action.amount ?? 0);
      if (action.counter === "load") target.fortressStr = Math.max(0, target.fortressStr - Number(action.amount ?? 0));
    } else {
      const target = findCard(state, uid);
      if (!target || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)) return false;
      if (action.counter === "load") target.card.load = Number(target.card.load ?? 0) + Number(action.amount ?? 0);
    }
    state.pending = null;
    if (continuation.triggerItemId) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "std179-place") {
    state.pending = null;
    if (result.scope !== "配置する") { openNextQueuedSelection(state); return true; }
    const card = player.hand.find((item) => item.uid === continuation.sourceUid && item.id === "STD-179");
    if (!card) { openNextQueuedSelection(state); return true; }
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const placed = placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: card.uid, sourceName: continuation.sourceName,
      onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
    }).status === "placed";
    openNextQueuedSelection(state);
    return placed;
  }
  if (continuation.type === "std182-attack-script") {
    state.pending = null;
    const attacker = player.front.find((item) => item.uid === continuation.attackerUid && item.id === "STD-182");
    if (!attacker) return false;
    attacker.skipStd182AttackEffect = true;
    if (!result.selected.length) return attack(state, playerId, attacker.uid, continuation.targetUid);
    const script = player.back.find((item) => item.uid === result.selected[0] && item.category === "Script" && item.faceDown
      && Number(item.activationCost ?? item.cost ?? Infinity) <= 2);
    if (!script) return attack(state, playerId, attacker.uid, continuation.targetUid);
    state.deferredAttack = { stage: "std182-script", playerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
    const activated = activateScript(state, playerId, script.uid);
    if (!activated) { state.deferredAttack = null; return attack(state, playerId, attacker.uid, continuation.targetUid); }
    resumeDeferredAttack(state);
    return true;
  }
  if (continuation.type === "std184-place-ob") {
    state.pending = null;
    if (result.scope !== "Obとして配置する") { openNextQueuedSelection(state); return true; }
    const index = player.back.findIndex((item) => item.uid === continuation.sourceUid && item.id === "STD-184" && item.std184Script && item.faceDown);
    if (index < 0) { openNextQueuedSelection(state); return true; }
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length - 1 < player.user.backLimit ? "back" : "front";
    const [card] = player.back.splice(index, 1);
    card.category = "Ob";
    delete card.std184Script;
    card.faceDown = false;
    card.residentActive = false;
    card.sleep = false;
    card.damage = 0;
    card.summoningSick = zone === "front";
    if (placeByMode(state, playerId, card, { zone, from: "back", source: continuation.sourceName }) !== "placed") { openNextQueuedSelection(state); return true; }
    emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
    addLog(state, `${continuation.sourceName}: Script状態からObとして${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "play-std229") {
    state.pending = null;
    const resume = continuation.options?.requestedSlot != null ? playCardCore : playCard;
    return resume(state, playerId, continuation.sourceUid, { ...continuation.options, targetUids: result.selected });
  }
  if (continuation.type === "std214-attack-cost") {
    const index = player.registry.findIndex((item) => item.uid === result.selected[0]);
    const attacker = player.front.find((item) => item.uid === continuation.attackerUid && item.id === "STD-214");
    state.pending = null;
    if (index < 0 || !attacker) return false;
    const [recovered] = player.registry.splice(index, 1); player.hand.push(recovered);
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: recovered.owner ?? playerId, cardUid: recovered.uid, cardId: recovered.id, cardName: recovered.name, category: recovered.category, reason: "attack-cost" });
    attacker.skipStd214AttackCost = true;
    return attack(state, playerId, attacker.uid, continuation.targetUid);
  }
  if (continuation.type === "std185-defender-substitute") {
    state.pending = null;
    const attacker = state.players[continuation.attackerPlayerId].front.find((item) => item.uid === continuation.attackerUid);
    if (!attacker) return false;
    attacker.skipStd185Substitution = true;
    const targetUid = result.scope === "クワガタ将軍と戦闘" ? continuation.generalUid : continuation.originalTargetUid;
    return attack(state, continuation.attackerPlayerId, attacker.uid, targetUid);
  }
  if (continuation.type === "std185-attacker-substitute") {
    state.pending = null;
    const original = player.front.find((item) => item.uid === continuation.attackerUid);
    const general = player.front.find((item) => item.uid === continuation.generalUid && item.id === "STD-185" && !item.sleep);
    if (!original || !general) return false;
    if (result.scope !== "クワガタ将軍と戦闘") {
      original.skipStd185AttackerSubstitution = true;
      return attack(state, playerId, original.uid, continuation.targetUid);
    }
    general.skipStd230Ambush = true;
    general.skipStd185AttackerSubstitution = true;
    return attack(state, playerId, general.uid, continuation.targetUid);
  }
  if (continuation.type === "std226-compress") {
    state.pending = null;
    if (!result.selected.length) { openNextQueuedSelection(state); return true; }
    const source = [...player.front, ...player.back].find((item) => item.uid === continuation.sourceUid && item.id === "STD-226" && !item.sleep);
    const target = findCard(state, result.selected[0]);
    if (source && target?.zoneName === "registry") { setCardSleeping(state, playerId, source); target.card.faceDown = true; }
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "std230-ambush-choice") {
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
  if (continuation.type === "std230-install-hand") {
    const opponent = state.players[continuation.opponentId];
    const chosenIndex = opponent.hand.findIndex((item) => item.uid === result.selected[0]);
    if (chosenIndex >= 0) { const [chosen] = opponent.hand.splice(chosenIndex, 1); player.registry.push(chosen); emitRegistryInstalled(state, playerId, chosen, "悪の発明"); }
    if (opponent.hand.length) { const randomIndex = Math.floor(state.rng() * opponent.hand.length); const [random] = opponent.hand.splice(randomIndex, 1); player.registry.push(random); emitRegistryInstalled(state, playerId, random, "悪の発明"); }
    state.pending = null;
    state.std230AmbushCleanup = continuation.cleanup;
    return resumeStd230AmbushCleanup(state);
  }
  if (continuation.type === "mounted-event-discard") {
    if (result.selected.length !== continuation.count) return false;
    for (const uid of result.selected) {
      const index = player.hand.findIndex((item) => item.uid === uid);
      if (index >= 0) moveCardToTrash(state, playerId, player.hand.splice(index, 1)[0], continuation.sourceName);
    }
    state.pending = null; openNextQueuedSelection(state); return true;
  }
  if (continuation.type === "grant-keyword") {
    const target = findCard(state, result.selected[0])?.card;
    if (!target) return false;
    target.grantedKeywords = [...new Set([...(target.grantedKeywords ?? []), continuation.keyword])];
    addLog(state, `${continuation.sourceName}: ${target.name}に[${continuation.keyword}]を付与。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "salvage-selected") {
    const index = player.trash.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [card] = player.trash.splice(index, 1);
    player.hand.push(card);
    addLog(state, `${continuation.sourceName}: ${card.name}をサルベージ。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "technology-horizon") {
    if (!result.selected.length) {
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 0体選択のため①以降を処理しない。`, "effect");
      return true;
    }
    const names = [];
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (location && destroyCard(state, location.playerId, uid, { source: continuation.sourceName })) names.push(location.card.name);
    }
    if (!names.length) { state.pending = null; return true; }
    const x = names.reduce((sum, name) => sum + player.trash.filter((card) => card.name === name).length * 2, 0);
    for (let index = 0; index < 2; index += 1) {
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const ghost = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-123", playerId, ++state.tokenSerial + 1200));
      ghost.permanentAtk = x;
      ghost.permanentStr = x;
      ghost.summoningSick = cardAtk(state, playerId, ghost) < 5;
      if (placeByMode(state, playerId, ghost, { zone, from: "generated", source: continuation.sourceName }) !== "placed") continue;
      emitEffectPlacement(state, playerId, ghost, zone, continuation.sourceName);
      if (cardMaxStr(state, playerId, ghost) <= 0) destroyCard(state, playerId, ghost.uid, { source: "STR0以下の状態判定", suppressReplacement: true });
    }
    addLog(state, `${continuation.sourceName}: ゴースト2体を生成し+${x}/+${x}。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "runtime-execute-from-trash") {
    const index = player.trash.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [spell] = player.trash.splice(index, 1);
    state.pending = null;
    resolveEffect(state, () => resolveSpell(state, playerId, spell, null));
    if (continuation.destinationAfterExecution === "deck") {
      player.deck.push(spell);
      if (continuation.shuffleAfter) player.deck = shuffle(player.deck, state.rng);
    }
    addLog(state, `${continuation.sourceName}: ${spell.name}をゴミ箱から起動し${continuation.destinationAfterExecution === "deck" ? "デッキへ戻した" : "処理した"}。`, "effect");
    if (continuation.triggerItemId) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "std207-reveal") {
    const target = player.hand.find((item) => item.uid === result.selected[0] && item.color === "紫");
    if (!target) return false;
    target.revealed = true;
    target.turnCostModifier = Number(target.turnCostModifier ?? 0) - 2;
    addLog(state, `クラフト・パッチワーク: ${target.name}を公開。このターン実行メモリ-2。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "destroy-selected") {
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (location) destroyCard(state, location.playerId, uid, { source: continuation.sourceName, suppressReplacement: true });
    }
    state.pending = null;
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "trigger-modify-grant") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) addTimedModifier(state, target, continuation.action, continuation.sourceName);
    state.pending = null;
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "trigger-modify-prevent-battle") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) {
      addTimedModifier(state, target, continuation.action, continuation.sourceName);
      grantDamageModifier(target, {
        direction: "received", damageKind: "battle", operation: "set", amount: 0,
        duration: "turn", activeTurn: state.turnNumber
      });
    }
    state.pending = null;
    return true;
  }
  if (continuation.type === "deal-selected-damage") {
    const location = findCard(state, result.selected[0]);
    if (!location) return false;
    dealCardDamage(state, location.playerId, location.card.uid, continuation.amount, continuation.sourceName);
    state.pending = null;
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "hahanamori-standby") {
    const source = findCard(state, continuation.sourceUid)?.card;
    if (!source) return false;
    if (result.selected.length) {
      const target = findCard(state, result.selected[0]);
      if (target) destroyCard(state, target.playerId, target.card.uid, { source: source.name, suppressReplacement: true });
      source.sleep = false;
      const defender = findCard(state, continuation.defenderUid)?.card;
      if (defender) defender.skipStandby = true;
      addLog(state, `${source.name}: 他のObを破壊してスタンバイ。戦闘相手は次の開始時にスタンバイしない。`, "effect");
    }
    state.pending = null;
    return true;
  }
  return false;
}

function resumeCardSelection(state, continuation, result) {
  const resolved = resolveCardSelectionCore(state, continuation, result);
  if (resolved && !state.pending && !state.prompt) continueDeferredSpellCleanup(state);
  if (resolved && !state.pending && !state.prompt) continueDeferredDeclaredResponseCleanup(state);
  if (resolved && !state.pending && !state.prompt) continueDeferredDeclaredScriptCleanup(state);
  if (resolved && !state.pending && !state.prompt) continuePlacementCostBatch(state);
  if (resolved) resumeMandatoryDrawContinuation(state);
  return resolved;
}

export function resolveCardSelection(state, continuation, result) {
  const resolved = runEffectEntry(state, "selection", continuation?.playerId ?? null, () => {
    const resumed = resumeCardSelection(state, continuation, result);
    if (resumed && !state.pending && !state.prompt) resumeStalledTriggerThread(state);
    return resumed;
  });
  const activeId = state.resumeTurnEndAfterSelection;
  if (resolved && activeId && !state.pending && !state.prompt) {
    delete state.resumeTurnEndAfterSelection;
    if (!state.winner) endTurn(state);
  }
  return resolved;
}

function moveCardByEffect(state, playerId, uid, targetZone, sourceName) {
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

export function resolveSamLogin(state, playerId, discardUid) {
  const player = state.players[playerId];
  const sourceUid = state.pending?.request?.continuation?.sourceUid;
  const source = sourceUid ? findCard(state, sourceUid)?.card : null;
  const index = player.hand.findIndex((card) => card.uid === discardUid
    && (source?.id === "STD-077" ? hasClass(card, "レッドパンクス") : card.color === "赤"));
  if (index < 0) return fail(state, "サムの効果で捨てる赤カードを選んで。", false);
  const [discarded] = player.hand.splice(index, 1);
  moveCardToTrash(state, playerId, discarded, "サムの効果コスト");
  drawCards(state, playerId, 2);
  state.pending = null;
  addLog(state, `ジャンカー・サム: ${discarded.name}を捨て、2枚ドロー。`, "effect");
  provisional(state, "レッドパンクス分類データが未整備のため、サムの手札コストは赤カード全般を選択可能。", CARD_LIBRARY["STD-077"]);
  return true;
}

export function resolveLuckyShotAdditional(state, playerId, targetUid) {
  const continuation = state.pending?.request?.continuation;
  if (continuation?.type === "runtime-action-selection" && continuation.sourceId === "STD-086") {
    return resolveCardSelection(state, continuation, { selected: [targetUid] });
  }
  const source = state.deferredSpellCleanup?.card?.id === "STD-086"
    ? state.deferredSpellCleanup.card
    : { ...CARD_LIBRARY["STD-086"], uid: "STD-086-legacy-compat" };
  const selection = cardRuntimeSpec("STD-086", "spell")?.actions?.find((action) => action.type === "select");
  if (!selection) return false;
  state.pending = null;
  return runEffectEntry(state, "lucky-shot-additional", playerId, () => executeRuntimeActions(
    state,
    playerId,
    source,
    selection.afterActions,
    { targetUid, targetUids: [targetUid], runtime: { records: Object.create(null) } }
  ));
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

function activateStd203Response(state, playerId, cardUid, selectedUids, responseEvent) {
  const own = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  const enemyId = otherPlayer(playerId);
  const enemy = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === enemyId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  if (!own || !enemy) return false;
  return declareResponse(state, playerId, cardUid, {
    targetUid: enemy.card.uid, targetUids: [own.card.uid, enemy.card.uid], responseEvent
  });
}

function triggerObDestroyedExtras(state, destroyedCard) {
  if (!isObCard(destroyedCard)) return;
  for (const [playerId, player] of Object.entries(state.players)) {
  }
}

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

function triggerStd165Threshold(state) {
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

export function resolveStd049TurnEnd(state, activeId) {
  const controllerId = otherPlayer(activeId);
  const player = state.players[controllerId];
  const armed = player.trash.filter((card) => card.id === "STD-049" && card.std049ProxyArmed);
  if (!armed.length) return;
  const calamities = [...player.front, ...player.back].filter((card) => card.id === "STD-050");
  if (!calamities.length) return;
  let destroyed = 0;
  for (const target of calamities) {
    if (destroyCard(state, controllerId, target.uid, { source: "宵の明星の起動コスト" })) destroyed += 1;
  }
  if (!destroyed) return;
  for (const source of armed) {
    dealFortressDamage(state, activeId, 5, controllerId, source.name);
    const trashIndex = player.trash.findIndex((card) => card.uid === source.uid);
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    if (trashIndex >= 0) {
      const [decoded] = player.trash.splice(trashIndex, 1);
      delete decoded.std049ProxyArmed;
      decoded.sleep = false;
      decoded.summoningSick = false;
      decoded.damage = 0;
      const placed = placeByMode(state, controllerId, decoded, { zone: zoneName, from: "trash", source: source.name }) === "placed";
      if (!placed) continue;
      addLog(state, `${source.name}: 災いの明星${destroyed}体を破壊し、5ダメージとデコードを解決。`, "effect");
    }
  }
}

export { CARD_LIBRARY };
