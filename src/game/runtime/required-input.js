import {
  activateResponse, activateScript, cardHasKeyword, configurePlugin, declinePrompt, declineResponse, endTurn,
  resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice, restSecurity, findCard
} from '../engine.js';
import { canConfirmSelection, confirmSelection } from '../selection-model.js';
import { isObCard } from '../card-types.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { buildRuntimeReferenceFrame } from './reference-frame.js';
import { findRuntimeCardReference } from './references.js';
import { opaqueOrdinal } from './opaque-id.js';
import { requiredSelectionRequest, validSelectionAnswer } from './selection-contract.js';
import { CARD_LIBRARY } from '../../data/cards.js';

const failure = code => ({ ok: false, error: { code } });
const optionId = index => opaqueOrdinal('option', index);
const groupId = index => opaqueOrdinal('group', index);
const choiceId = (revision, source) => `choice:${revision}:${source}`;
const seatForPlayer = (metadata, playerId) => metadata.seatIds[playerId === 'player' ? 0 : 1];

function pickConstraints(request, candidates) {
  const optionFor = new Map(candidates.map((value, index) => [value, optionId(index)]));
  const comparator = request.exactBudget !== null && request.exactBudget !== undefined ? '='
    : request.budget !== null && request.budget !== undefined ? '<=' : null;
  const aggregate = comparator === null ? null : {
    comparator,
    value: Number(comparator === '=' ? request.exactBudget : request.budget),
    optionValues: candidates.map((value, index) => ({
      optionId: optionId(index), value: Number(request.candidateValues?.[value] ?? 0)
    }))
  };
  const groups = (request.groups ?? []).map((group, index) => ({
    groupId: groupId(index),
    minimum: Number(group.minimum ?? 0),
    maximum: Math.min(candidates.length, Number.isFinite(group.maximum ?? group.count)
      ? Number(group.maximum ?? group.count) : candidates.length),
    optionIds: candidates.filter(value => group.candidates?.includes(value)).map(value => optionFor.get(value))
  }));
  return {
    kind: 'pick', minimum: Number(request.minimum ?? 0),
    maximum: Math.min(candidates.length, Number.isFinite(request.maximum ?? request.count)
      ? Number(request.maximum ?? request.count) : candidates.length), aggregate, groups
  };
}

function selectionConstraints(request, candidates) {
  if (request.mode === 'random') return {
    kind: 'random', answer: 'commit-empty', count: Number(request.count ?? 0)
  };
  if (request.spec?.kind === 'allocation') return {
    kind: 'allocation', total: Number(request.spec.total ?? 0),
    minimumPerOption: Number(request.spec.minimumPerTarget ?? 0),
    maximumPerOption: request.spec.maximumPerTarget === null ? null : Number(request.spec.maximumPerTarget),
    allowNoOptions: Boolean(request.spec.allowNoTargets),
    optionIds: candidates.map((_, index) => optionId(index))
  };
  return pickConstraints(request, candidates);
}

const fixedPick = (minimum, maximum) => ({
  kind: 'pick', minimum, maximum, aggregate: null, groups: []
});

function selectionPresentationKey(request) {
  if (request.spec?.kind === 'allocation') return 'allocation';
  if (request.mode === 'random') return 'random';
  if (request.mode === 'scope') return request.spec?.kind === 'choice' ? 'choice' : 'value';
  if ((request.groups ?? []).length > 0) return 'grouped-card';
  return 'card';
}

function cardReference(engineState, referenceState, metadata, viewerSeat, uid) {
  const index = buildRuntimeIdentityIndex(engineState);
  if (!index.ok) return null;
  const alias = engineState.runtimeContext.uidAliases.find(item => item.uid === uid);
  if (!alias) return null;
  const entry = index.value.entries.find(item => item.identity.instanceId === alias.identity.instanceId);
  if (!entry) return null;
  const frame = buildRuntimeReferenceFrame(engineState);
  if (!frame.ok) return null;
  const found = findRuntimeCardReference(referenceState, {
    frame: frame.value, matchId: metadata.matchId, viewerSeat, identity: entry.identity
  });
  return found.ok ? found.value.cardRef : null;
}

function cardOptions(engineState, referenceState, metadata, actorSeat, candidates, labels = {}, surfacePermission = false) {
  const actorId = metadata.seatIds[0] === actorSeat ? 'player' : 'ai';
  return candidates.map((uid, index) => {
    const found = findCard(engineState, uid);
    const visible = found && (found.playerId === actorId && found.zoneName === 'hand'
      || surfacePermission && found.playerId === actorId && !found.card.faceDown
      || !['hand', 'deck'].includes(found.zoneName) && !found.card.faceDown);
    const definition = visible ? CARD_LIBRARY[found.card.id] : null;
    return {
      optionId: optionId(index), kind: 'card',
      cardRef: cardReference(engineState, referenceState, metadata, actorSeat, uid),
      label: visible ? (typeof labels?.[uid] === 'string' ? labels[uid] : found.card.name) : null,
      ...(definition ? { preview: { definitionId:definition.id,name:definition.name,
        definition:{id:definition.id,name:definition.name,category:definition.category,color:definition.color ?? null,
          cost:definition.cost ?? null,atk:definition.atk ?? null,str:definition.str ?? null,text:definition.text ?? '',classes:[...(definition.classes ?? [])]} } } : {})
    };
  });
}

const CARD_IDS_BY_NAME = new Map(Object.values(CARD_LIBRARY).map(definition => [definition.name, definition.id]));
// Continuations name their card in several ways: by id, by the card on the board, by name, or by a card-specific type.
function effectSource(engineState, continuation) {
  const uid = continuation?.sourceUid ?? continuation?.scriptUid;
  const typed = /^(std|sztb)(\d{3})/i.exec(continuation?.type ?? '');
  const id = [continuation?.sourceId, uid ? findCard(engineState, uid)?.card?.id : null,
    CARD_IDS_BY_NAME.get(continuation?.sourceName), typed ? `${typed[1].toUpperCase()}-${typed[2]}` : null]
    .find(candidate => typeof candidate === 'string' && Object.hasOwn(CARD_LIBRARY, candidate));
  const definition = id ? CARD_LIBRARY[id] : null;
  return definition ? { definitionId: definition.id, name: definition.name, text: definition.text ?? '' } : null;
}

function selectionInput(engineState, referenceState, metadata, revision, pending) {
  const request = pending.request;
  const playerId = request?.continuation?.playerId;
  if (!['player', 'ai'].includes(playerId) || !request || typeof request.mode !== 'string') return null;
  const actorSeat = seatForPlayer(metadata, playerId);
  const source = effectSource(engineState, request.continuation);
  const scope = request.mode === 'scope';
  const candidates = scope ? request.scopeOptions : request.candidates;
  if (!Array.isArray(candidates)) return null;
  const options = request.mode === 'random' ? [] : scope
    ? candidates.map((value, index) => ({ optionId: optionId(index), kind: 'value', label: String(value) }))
    : cardOptions(engineState, referenceState, metadata, actorSeat, candidates, request.candidateLabels,
      ['runtime-access-reference','access-to-hand','access-drag','access-distribute','selection-module-look'].includes(request.continuation?.type));
  return {
    source: 'selection', playerId, actorSeat, rawOptions: [...candidates],
    dto: {
      choiceId: choiceId(revision, 'selection'), kind: request.spec?.kind === 'allocation' ? 'allocation' : 'selection',
      presentationKey: selectionPresentationKey(request), actorSeat,
      // The engine's prompt line names what the pick is for; the actor already knows its own source.
      ...(typeof request.label === 'string' && request.label ? { title: request.label } : {}),
      // The card whose effect is asking, so the chooser can see which clause is resolving.
      ...(source ? { source } : {}),
      optional: request.mode !== 'random' && Number(request.minimum ?? 1) === 0,
      minimum: request.mode === 'random' ? 0 : Number(request.minimum ?? 0),
      maximum: request.mode === 'random' ? 0 : Number(request.maximum ?? request.count ?? 1), options,
      constraints: selectionConstraints(request, candidates)
    }
  };
}

function promptInput(metadata, revision, prompt) {
  if (!['player', 'ai'].includes(prompt?.playerId)) return null;
  const actorSeat = seatForPlayer(metadata, prompt.playerId);
  if (prompt.type === 'plugin-number') return {
    source: 'plugin-number', playerId: prompt.playerId, actorSeat,
    rawOptions: Array.from({ length: 8 }, (_, value) => value),
    dto: {
      choiceId: choiceId(revision, 'plugin-number'), kind: 'selection', presentationKey: 'plugin-number', actorSeat,
      optional: false, minimum: 1, maximum: 1,
      options: Array.from({ length: 8 }, (_, value) => ({ optionId: optionId(value), kind: 'value', label: String(value) })),
      constraints: fixedPick(1, 1)
    }
  };
  if (prompt.type === 'script-activation') return {
    source: 'script-activation', playerId: prompt.playerId, actorSeat, rawOptions: ['activate'],
    dto: {
      choiceId: choiceId(revision, 'script-activation'), kind: 'confirmation', presentationKey: 'script-activation', actorSeat,
      optional: true, minimum: 0, maximum: 1,
      options: [{ optionId: optionId(0), kind: 'value', label: '起動' }],
      constraints: { kind: 'confirmation', minimum: 0, maximum: 1 }
    }
  };
  return null;
}

function pendingInput(engineState, referenceState, metadata, revision, pending) {
  if (pending?.type === 'selection') return selectionInput(engineState, referenceState, metadata, revision, pending);
  if (pending?.type === 'response-window') {
    const actorSeat = seatForPlayer(metadata, pending.playerId);
    return {
      source: 'response-window', playerId: pending.playerId, actorSeat, rawOptions: [...pending.candidates],
      dto: {
        choiceId: choiceId(revision, 'response-window'), kind: 'selection', presentationKey: 'response-window', actorSeat,
        optional: true, minimum: 0, maximum: 1,
        options: cardOptions(engineState, referenceState, metadata, actorSeat, pending.candidates, pending.candidateLabels),
        constraints: fixedPick(0, 1)
      }
    };
  }
  if (pending?.type === 'response-target') {
    const actorSeat = seatForPlayer(metadata, pending.playerId);
    return {
      source: 'response-target', playerId: pending.playerId, actorSeat, rawOptions: [...pending.validTargets],
      dto: {
        choiceId: choiceId(revision, 'response-target'), kind: 'selection', presentationKey: 'response-target', actorSeat,
        optional: false, minimum: 1, maximum: 1,
        options: cardOptions(engineState, referenceState, metadata, actorSeat, pending.validTargets),
        constraints: fixedPick(1, 1)
      }
    };
  }
  if (pending?.type === 'trigger-order') {
    const playerId = engineState.triggerThread?.currentControllerId;
    if (!['player', 'ai'].includes(playerId)) return null;
    const actorSeat = seatForPlayer(metadata, playerId);
    const items = engineState.triggerThread.items.filter(item => item.status === 'pending' && item.controllerId === playerId);
    return {
      source: 'trigger-order', playerId, actorSeat, rawOptions: items.map(item => item.id),
      dto: {
        choiceId: choiceId(revision, 'trigger-order'), kind: 'selection', presentationKey: 'trigger-order', actorSeat,
        optional: false, minimum: 1, maximum: 1,
        options: items.map((item, index) => ({ optionId: optionId(index), kind: 'value', label: item.trigger?.source?.card?.name ?? `誘発${index + 1}` })),
        constraints: fixedPick(1, 1)
      }
    };
  }
  if (['access-drag-place', 'decode-place', 'std048-draw-place'].includes(pending?.type)) {
    const actorSeat = seatForPlayer(metadata, pending.playerId);
    const hosts = ['front', 'back'].flatMap(zone => engineState.players[pending.playerId][zone]
      .filter(card => !card.faceDown && isObCard(card))
      .map(card => ({ zone, underUid: card.uid })));
    const destinations = [{ zone: 'front' }, { zone: 'back' }, ...hosts];
    return {
      source: 'placement', playerId: pending.playerId, actorSeat,
      rawOptions: destinations,
      dto: {
        choiceId: choiceId(revision, 'placement'), kind: 'selection', presentationKey: pending.type, actorSeat,
        optional: false, minimum: 1, maximum: 1,
        options: [
          { optionId: optionId(0), kind: 'destination', label: 'フロント' },
          { optionId: optionId(1), kind: 'destination', label: 'バック' },
          ...hosts.map((host, index) => ({
            optionId: optionId(index + 2), kind: 'destination', label: 'レイヤー配置',
            cardRef: cardReference(engineState, referenceState, metadata, actorSeat, host.underUid)
          }))
        ],
        constraints: fixedPick(1, 1)
      }
    };
  }
  return null;
}

function securityInput(engineState, referenceState, metadata, revision) {
  const playerId = engineState.securityRestWindow;
  if (!['player', 'ai'].includes(playerId)) return null;
  const actorSeat = seatForPlayer(metadata, playerId);
  const candidates = engineState.players[playerId].front
    .filter(card => !card.faceDown && !card.sleep && cardHasKeyword(card, 'SECURITY'))
    .map(card => card.uid);
  return {
    source: 'security-rest', playerId, actorSeat, rawOptions: candidates,
    dto: {
      choiceId: choiceId(revision, 'security-rest'), kind: 'selection', presentationKey: 'security-rest', actorSeat,
      optional: true, minimum: 0, maximum: 1,
      options: cardOptions(engineState, referenceState, metadata, actorSeat, candidates),
      constraints: fixedPick(0, 1)
    }
  };
}

function current(authority) {
  const { engineState, referenceState, metadata, revision } = authority;
  return pendingInput(engineState, referenceState, metadata, revision, engineState.pending)
    ?? promptInput(metadata, revision, engineState.prompt)
    ?? securityInput(engineState, referenceState, metadata, revision);
}

export function buildRequiredInput(authority, viewerSeat) {
  try {
    const input = current(authority);
    if (!input) return { ok: true, value: null };
    const canAnswer = input.actorSeat === viewerSeat;
    if (!canAnswer) return { ok: true, value: {
      kind: 'waiting', actorSeat: input.actorSeat, canAnswer: false,
      options: [], constraints: { kind: 'waiting' }
    } };
    return { ok: true, value: { ...input.dto, canAnswer: true } };
  } catch {
    return failure('REQUIRED_INPUT_INVALID_STATE');
  }
}

export function prepareRequiredInputAction(authority, actorSeat, action) {
  const input = current(authority);
  if (!input || input.actorSeat !== actorSeat || action.choiceId !== input.dto.choiceId) return failure('ACTION_NOT_ALLOWED');
  if (action.type === 'declineChoice') {
    if (!input.dto.optional) return failure('ACTION_NOT_ALLOWED');
    return { ok: true, value: { engineFunction: 'declineRequiredInput', playerId: input.playerId, revision: authority.revision } };
  }
  if (!validSelectionAnswer(requiredSelectionRequest(input.dto), {
    requestId: action.choiceId, optionIds: action.optionIds, allocation: action.allocation
  })) return failure('ACTION_NOT_ALLOWED');
  const indexes = action.optionIds.map(id => input.dto.options.findIndex(option => option.optionId === id));
  if (indexes.some(index => index < 0) || new Set(indexes).size !== indexes.length) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.optional && indexes.length === 0 && action.allocation.length === 0 && input.source !== 'selection') {
    return {ok:true,value:{engineFunction:'declineRequiredInput',playerId:input.playerId,revision:authority.revision}};
  }
  const allocation = action.allocation.map(entry => ({
    optionIndex: input.dto.options.findIndex(option => option.optionId === entry.optionId), amount: entry.amount
  }));
  if (allocation.some(entry => entry.optionIndex < 0)) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.kind !== 'allocation' && allocation.length) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.kind === 'allocation') {
    if (allocation.some(entry => !Number.isSafeInteger(entry.amount) || entry.amount <= 0)
      || new Set(allocation.map(entry => entry.optionIndex)).size !== allocation.length) return failure('ACTION_NOT_ALLOWED');
    const positive = [...allocation.map(entry => entry.optionIndex)].sort((a, b) => a - b);
    const selected = [...indexes].sort((a, b) => a - b);
    if (positive.length !== selected.length || positive.some((value, index) => value !== selected[index])) {
      return failure('ACTION_NOT_ALLOWED');
    }
  }
  if (input.source === 'selection' && authority.engineState.pending.request.mode === 'random' && action.optionIds.length) {
    return failure('ACTION_NOT_ALLOWED');
  }
  return { ok: true, value: {
    engineFunction: 'answerRequiredInput', playerId: input.playerId, revision: authority.revision,
    optionIndexes: indexes, allocation
  } };
}

function applySelection(engineState, input, adapter) {
  const request = engineState.pending.request;
  const draft = structuredClone(request);
  if (request.mode === 'scope') draft.selectedScope = input.rawOptions[adapter.optionIndexes[0]] ?? null;
  else if (request.mode !== 'random') draft.selected = adapter.optionIndexes.map(index => input.rawOptions[index]);
  if (request.spec?.kind === 'allocation') {
    draft.allocation = Object.fromEntries(input.rawOptions.map(value => [value, 0]));
    for (const entry of adapter.allocation) {
      if (entry.optionIndex < 0 || !Number.isSafeInteger(entry.amount) || entry.amount < 0) return false;
      draft.allocation[input.rawOptions[entry.optionIndex]] = entry.amount;
    }
    draft.selected = input.rawOptions.filter(value => draft.allocation[value] > 0);
  }
  if (!canConfirmSelection(draft)) return false;
  const result = confirmSelection(draft, engineState.rng);
  return result !== null && resolveCardSelection(engineState, request.continuation, result);
}

export function applyRequiredInputAction(engineState, metadata, referenceState, adapter, decline = false) {
  const input = current({ engineState, metadata, referenceState, revision: adapter.revision });
  if (!input || input.playerId !== adapter.playerId) return false;
  if (decline) {
    if (!input.dto.optional) return false;
    if (input.source === 'script-activation') return declinePrompt(engineState);
    if (input.source === 'response-window') return declineResponse(engineState, input.playerId);
    // endTurn deletes this window before opening a later end-of-turn choice.
    // A consumed window is accepted even when the turn is not complete yet.
    if (input.source === 'security-rest') return endTurn(engineState) || engineState.securityRestWindow == null;
    if (input.source === 'selection' && engineState.pending.request.mode !== 'scope') {
      return resolveCardSelection(engineState, engineState.pending.request.continuation, { selected: [] });
    }
    return false;
  }
  if (input.source === 'selection') return applySelection(engineState, input, adapter);
  const selected = input.rawOptions[adapter.optionIndexes[0]];
  if (selected === undefined || adapter.optionIndexes.length !== 1) return false;
  if (input.source === 'plugin-number') return configurePlugin(engineState, input.playerId, engineState.prompt.pluginUid, selected);
  if (input.source === 'script-activation') return activateScript(engineState, input.playerId, engineState.prompt.scriptUid);
  if (input.source === 'response-window') return activateResponse(engineState, input.playerId, selected);
  if (input.source === 'response-target') return activateResponse(engineState, input.playerId, engineState.pending.cardUid, selected);
  if (input.source === 'trigger-order') return resolveTriggerChoice(engineState, selected);
  if (input.source === 'placement') return resolveAccessDragPlacement(engineState, input.playerId, selected.zone, selected.underUid ?? null);
  if (input.source === 'security-rest') {
    if (!restSecurity(engineState, input.playerId, selected)) return false;
    // With nothing left to rest, the turn end carries on instead of asking again with no options.
    const remaining = engineState.players[input.playerId].front
      .some(card => !card.faceDown && !card.sleep && cardHasKeyword(card, 'SECURITY'));
    if (!remaining) endTurn(engineState);
    return true;
  }
  return false;
}
