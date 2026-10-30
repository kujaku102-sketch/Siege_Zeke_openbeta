import { TRACE_TAGS, trace } from "../../engine-trace.js";
import { isLydCard, isObCard, matchesCardCategory } from "../../card-types.js";
import { flattenedLayerCount, flattenedLayers } from "../../layered-specs.js";
import { cardTraits, classKey, findCard, hasClass, hasNoEffectText, isArmsBandCard, otherPlayer } from "../../core/shared.js";
import { cardHasKeyword } from "../../core/stats.js";
import { placementResult } from "./placement.js";
import { runtimeZoneChoiceOptions } from "./selection-choice.js";
import { runtimePlayerCandidates, runtimeSelectionCandidates } from "./selection-target.js";

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

export function runtimeSpecCondition(state, playerId, source, condition, runtime = null, targetUid = null) {
  const result = evaluateRuntimeSpecCondition(state, playerId, source, condition, runtime, targetUid);
  if (condition) trace(state, { tag: TRACE_TAGS.CONDITION, result: Boolean(result), expression: condition.expression ?? condition.type ?? null, cardId: source?.id ?? null, playerId });
  return result;
}

function evaluateRuntimeSpecCondition(state, playerId, source, condition, runtime, targetUid) {
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

export function runtimeSpecTargets(state, playerId, source, targetUid, target) {
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

export function runtimeFieldValues(card, field) {
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
