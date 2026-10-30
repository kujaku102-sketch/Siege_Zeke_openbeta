import { hasKeyword, keywordValue } from "../../effect-compiler.js";
import { createAllocationSpec, createChoiceSpec, createSelectionRequest, createSelectionSpec, isSelectionRequestFeasible, selectionRequestFromSpec } from "../../selection-model.js";
import { CARD_LIBRARY } from "../../../data/cards.js";
import { createRuntimeCard, RuntimeError } from "../../runtime/factory.js";
import { cardPlacementCostSpec, cardRuntimeSpec } from "../../card-runtime-specs.js";
import { isObCard, matchesCardCategory } from "../../card-types.js";
import { inheritBoardSlot } from "../../board-slots.js";
import { normalizeMountedStack } from "../../layered-specs.js";
import { attack, cardAtk, cardCurrentStr, cardMaxStr, continueAttackAfterCost, dealCardDamage, resumeDeferredAttack } from "../../core/battle.js";
import { continueDeferredDeclaredScriptCleanup, resolveEffect, runEffectEntry } from "../../core/effects.js";
import { continueDeferredSpellCleanup, finalizeDeferredSpellCleanup, getEffectTargets, playCard, playCardCore, relogCard, resolveLogin, resolveSpell, spellNeedsTarget } from "../../core/play.js";
import { openNextQueuedSelection } from "../../core/projection.js";
import { continueDeferredDeclaredResponseCleanup } from "../../core/response.js";
import { activateScript } from "../../core/scripts.js";
import { hydrateCard } from "../../core/setup.js";
import { addLog, findCard, hasClass, isArmsBandOb, otherPlayer, shuffle } from "../../core/shared.js";
import { emitGameEvent, emitUserAbilityFeedback, resumeStalledTriggerThread, resumeTriggerThreadAfterSelection } from "../../core/triggers.js";
import { completeTurnAfterDelayedEffects, drawCards, endTurn, resumeMandatoryDrawContinuation } from "../../core/turn.js";
import { openStd141EffectChoice, scheduleStd141TurnEndResume, takeStd141TurnEndSource } from "../custom/std_141.js";
import { continueStd142DestroyResolution, scheduleStd142TurnEndResume } from "../custom/std_142.js";
import { continueStd163Choices } from "../custom/std_163.js";
import { activateStd203Response } from "../custom/std_203.js";
import { resumeStd230AmbushCleanup } from "../custom/std_230.js";
import { addTimedModifier, executeRuntimeActions, resumeDestroyLkiFollowUp, runtimeActionCandidates, runtimeActionFeasible, runtimeSpecMatchesCard, runtimeSpecValue } from "./actions.js";
import { beginSourceLayerSelection, consumeSelectedSourceLayers, continuePlacementCostBatch, ownLayerEntries, placementCostCandidates } from "./cost.js";
import { grantDamageModifier } from "./damage.js";
import { createVengeanceCard, destroyCard, emitCardsGenerated, emitEffectPlacement, emitRegistryInstalled, moveCardToTrash, placeByMode, placeCardByEffect, placementResult, setCardSleeping, settleDestructionContinuations } from "./placement.js";

function runtimeAccessCandidates(player, action, referenceCard = null) {
  return player.deck.filter((card) => runtimeSpecMatchesCard(card, action.filter, referenceCard));
}

export function runtimeSelectionCandidates(state, playerId, source, action, runtime = { records: Object.create(null) }) {
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

export function openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta = {}) {
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

export function runtimePlayerCandidates(state, action) {
  return Object.entries(state.players)
    .filter(([, player]) => !action.filter?.trashNonEmpty || player.trash.length > 0)
    .map(([id]) => id);
}

export function openRuntimePlayerSelection(state, playerId, source, action, runtime) {
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

export function runtimeSourceFromContinuation(state, continuation) {
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

export function openRuntimeAccessSelection(state, playerId, source, action, referenceCard = null, revealedUid = null, continuationMeta = {}) {
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

export function openRuntimeDecodeSelection(state, playerId, source, action, runtime) {
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

export function openRuntimeChoiceSelection(state, playerId, source, action, runtime) {
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

export function runtimeZoneChoiceOptions(state, playerId, source, action) {
  const location = findCard(state, source.uid);
  if (location?.playerId !== playerId || !["front", "back"].includes(location.zoneName)) return [];
  const requested = action.destinations === "other_area"
    ? [location.zoneName === "front" ? "back" : "front"]
    : action.destinations ?? [];
  return requested.filter((zone) => ["front", "back"].includes(zone) && placementResult(state.players[playerId], zone).ok);
}

export function openRuntimeZoneChoice(state, playerId, source, action, runtime) {
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

export function openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining) {
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
