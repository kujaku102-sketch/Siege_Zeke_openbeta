import {
  activateResponse, activateScript, cardHasKeyword, configurePlugin, declinePrompt, declineResponse, endTurn,
  resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice, restSecurity
} from '../engine.js';
import { canConfirmSelection, confirmSelection } from '../selection-model.js';
import { isObCard } from '../card-types.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { buildRuntimeReferenceFrame } from './reference-frame.js';
import { findRuntimeCardReference } from './references.js';

const failure = code => ({ ok: false, error: { code } });
const optionId = index => `option:${index + 1}`;
const choiceId = (revision, source) => `choice:${revision}:${source}`;
const seatForPlayer = (metadata, playerId) => metadata.seatIds[playerId === 'player' ? 0 : 1];

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

function cardOptions(engineState, referenceState, metadata, actorSeat, candidates, labels = {}) {
  return candidates.map((uid, index) => ({
    optionId: optionId(index), kind: 'card',
    cardRef: cardReference(engineState, referenceState, metadata, actorSeat, uid),
    label: typeof labels?.[uid] === 'string' ? labels[uid] : null
  }));
}

function selectionInput(engineState, referenceState, metadata, revision, pending) {
  const request = pending.request;
  const playerId = request?.continuation?.playerId;
  if (!['player', 'ai'].includes(playerId) || !request || typeof request.mode !== 'string') return null;
  const actorSeat = seatForPlayer(metadata, playerId);
  const scope = request.mode === 'scope';
  const candidates = scope ? request.scopeOptions : request.candidates;
  if (!Array.isArray(candidates)) return null;
  const options = request.mode === 'random' ? [] : scope
    ? candidates.map((value, index) => ({ optionId: optionId(index), kind: 'value', label: String(value) }))
    : cardOptions(engineState, referenceState, metadata, actorSeat, candidates, request.candidateLabels);
  return {
    source: 'selection', playerId, actorSeat, rawOptions: [...candidates],
    dto: {
      choiceId: choiceId(revision, 'selection'), kind: request.spec?.kind === 'allocation' ? 'allocation' : 'selection',
      presentationKey: String(request.continuation?.type ?? 'selection'), actorSeat,
      optional: Number(request.minimum ?? 1) === 0,
      minimum: request.mode === 'random' ? 0 : Number(request.minimum ?? 0),
      maximum: request.mode === 'random' ? 0 : Number(request.maximum ?? request.count ?? 1), options
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
      options: Array.from({ length: 8 }, (_, value) => ({ optionId: optionId(value), kind: 'value', label: String(value) }))
    }
  };
  if (prompt.type === 'script-activation') return {
    source: 'script-activation', playerId: prompt.playerId, actorSeat, rawOptions: ['activate'],
    dto: {
      choiceId: choiceId(revision, 'script-activation'), kind: 'confirmation', presentationKey: 'script-activation', actorSeat,
      optional: true, minimum: 0, maximum: 1,
      options: [{ optionId: optionId(0), kind: 'value', label: '起動' }]
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
        options: cardOptions(engineState, referenceState, metadata, actorSeat, pending.candidates, pending.candidateLabels)
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
        options: cardOptions(engineState, referenceState, metadata, actorSeat, pending.validTargets)
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
        options: items.map((item, index) => ({ optionId: optionId(index), kind: 'value', label: item.trigger?.source?.card?.name ?? `誘発${index + 1}` }))
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
        ]
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
      options: cardOptions(engineState, referenceState, metadata, actorSeat, candidates)
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
    return { ok: true, value: { ...input.dto, canAnswer, options: canAnswer ? input.dto.options : [] } };
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
  const indexes = action.optionIds.map(id => input.dto.options.findIndex(option => option.optionId === id));
  if (indexes.some(index => index < 0) || new Set(indexes).size !== indexes.length) return failure('ACTION_NOT_ALLOWED');
  const allocation = action.allocation.map(entry => ({
    optionIndex: input.dto.options.findIndex(option => option.optionId === entry.optionId), amount: entry.amount
  }));
  if (allocation.some(entry => entry.optionIndex < 0)) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.kind !== 'allocation' && allocation.length) return failure('ACTION_NOT_ALLOWED');
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
    if (input.source === 'security-rest') return endTurn(engineState) || engineState.securityRestWindow === null;
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
  if (input.source === 'security-rest') return restSecurity(engineState, input.playerId, selected);
  return false;
}
