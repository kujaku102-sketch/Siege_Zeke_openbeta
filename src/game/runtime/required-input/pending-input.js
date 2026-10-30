import { cardHasKeyword } from '../../engine.js';
import { isObCard } from '../../card-types.js';
import { cardOptions, cardReference } from './card-options.js';
import { selectionInput } from './selection-input.js';
import { choiceId, fixedPick, optionId, seatForPlayer } from './shared.js';

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

export function current(authority) {
  const { engineState, referenceState, metadata, revision } = authority;
  return pendingInput(engineState, referenceState, metadata, revision, engineState.pending)
    ?? promptInput(metadata, revision, engineState.prompt)
    ?? securityInput(engineState, referenceState, metadata, revision);
}
