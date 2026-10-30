import { CARD_LIBRARY } from "../../../data/cards.js";
import { swapBoardSlots } from "../../board-slots.js";
import { cardRuntimeSpec } from "../../card-runtime-specs.js";
import { isLydCard, isObCard, matchesCardCategory } from "../../card-types.js";
import { flattenedLayerCount, flattenedLayers } from "../../layered-specs.js";
import { createRuntimeToken } from "../../runtime/factory.js";
import { createChoiceSpec, createSelectionRequest, selectionRequestFromSpec } from "../../selection-model.js";
import { cardHasKeyword, dealCardDamage, dealFortressDamage } from "../../core/battle.js";
import { drawCards } from "../../core/draw.js";
import { playCard } from "../../core/play.js";
import { enqueueSelection, selectionProjectionMeta } from "../../core/projection.js";
import { queueMemoryLimitIncreasePrompt } from "../../core/scripts.js";
import { hydrateCard } from "../../core/setup.js";
import { addLog, cardTraits, classKey, findCard, hasClass, hasNoEffectText, isArmsBandCard, isSlashSpell, otherPlayer, shuffle } from "../../core/shared.js";
import { resolveMadnessChecks } from "../../core/turn.js";
import { getMaxMemory, ownLayerEntries } from "./cost.js";
import { banGeneratedCards, clearComponents, createVengeanceCard, destroyCard, distributeLayeredFollowers, emitCardsGenerated, emitEffectPlacement, emitRegistryInstalled, moveCardByEffect, moveCardToTrash, placeByMode, placeCardByEffect, placementResult, queueRuntimeDestructionContinuation, revealMountedCode, setCardSleeping, triggerMoved } from "./placement.js";
import { openRuntimeAccessSelection, openRuntimeChoiceSelection, openRuntimeDecodeSelection, openRuntimePlayerSelection, openRuntimeRepeatSelectMove, openRuntimeTargetSelection, openRuntimeZoneChoice, runtimePlayerCandidates, runtimeSelectionCandidates, runtimeZoneChoiceOptions } from "./selection.js";

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

export function addTimedModifier(state, card, action, sourceName) {
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

export function runtimeSpecMatchesCard(card, filter = {}, referenceCard = null, context = null) {
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

export function runtimeActionCandidates(state, playerId, source, action, runtime) {
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
      const moved = banGeneratedCards(state, runtime.records?.eventCardUids ?? [], source.name);
      if (action.recordAs) runtime.records[action.recordAs] = moved;
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
