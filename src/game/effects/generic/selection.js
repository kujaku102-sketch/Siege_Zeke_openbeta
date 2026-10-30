import { keywordValue } from "../../../../packages/effect-compiler/index.js";
import { CARD_LIBRARY } from "../../../data/cards.js";
import { cardPlacementCostSpec, cardRuntimeSpec } from "../../card-runtime-specs.js";
import { isObCard, matchesCardCategory } from "../../card-types.js";
import { normalizeMountedStack } from "../../layered-specs.js";
import { RuntimeError } from "../../runtime/factory.js";
import { createAllocationSpec, createChoiceSpec, createSelectionRequest, createSelectionSpec, isSelectionRequestFeasible, selectionRequestFromSpec } from "../../selection-model.js";
import { attack, dealCardDamage } from "../../core/battle.js";
import { resumeMandatoryDrawContinuation } from "../../core/draw.js";
import { continueDeferredDeclaredScriptCleanup, resolveEffect, runEffectEntry } from "../../core/effects.js";
import { continueDeferredSpellCleanup, getEffectTargets, playCard, playCardCore, relogCard, resolveSpell } from "../../core/play.js";
import { openNextQueuedSelection } from "../../core/projection.js";
import { continueDeferredDeclaredResponseCleanup } from "../../core/response.js";
import { activateScript } from "../../core/scripts.js";
import { addLog, findCard, hasClass, otherPlayer, shuffle } from "../../core/shared.js";
import { emitGameEvent, emitUserAbilityFeedback, resumeStalledTriggerThread, resumeTriggerThreadAfterSelection } from "../../core/triggers.js";
import { endTurn } from "../../core/turn.js";
import { CUSTOM_RESOLVE_CARD_SELECTION_CORE, CUSTOM_SELECTION_HANDLERS, PASS } from "../custom/index.js";
import { addTimedModifier, executeRuntimeActions, runtimeActionCandidates, runtimeActionFeasible, runtimeSpecMatchesCard, runtimeSpecValue } from "./actions.js";
import { beginSourceLayerSelection, consumeSelectedSourceLayers, continuePlacementCostBatch, ownLayerEntries, placementCostCandidates } from "./cost.js";
import { grantDamageModifier } from "./damage.js";
import { destroyCard, moveCardToTrash, placementResult, setCardSleeping } from "./placement.js";

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
  const customHandler = CUSTOM_SELECTION_HANDLERS[continuation.type];
  if (customHandler) return customHandler(state, continuation, result, playerId, player);
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
    const customResolveCardSelectionCore = CUSTOM_RESOLVE_CARD_SELECTION_CORE[source.id];
    if (customResolveCardSelectionCore) {
      const customResult = customResolveCardSelectionCore({ source, state, playerId, continuation });
      if (customResult !== PASS) return customResult;
    }
    const candidates = player.trash.filter((card) => isObCard(card) || card.category === "Code");
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
      exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
      label: "元々のメモリ合計ちょうど2を選択", message: source.text,
      continuation: { type: "std102-place", playerId, sourceUid: source.uid, targetUid: continuation.targetUid } });
    if (!isSelectionRequestFeasible(request)) return false;
    state.pending = { type: "selection", validTargets: request.candidates, request };
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
