import { cardHasKeyword } from '../../engine.js';
import { isObCard } from '../../card-types.js';
import { vacantBoardSlots } from '../../board-slots.js';
import { cardOptions, cardReference, placedCardView } from './card-options.js';
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
    const player = engineState.players[pending.playerId];
    const uid = pending.queue[0];
    const placing = pending.type === 'decode-place' ? pending.cards.find(card => card.uid === uid) : player.hand.find(card => card.uid === uid);
    // Only a Code goes under an Ob already on the board (rulebook 3.4); any other card has the empty slots only.
    const hosts = placing?.category !== 'Code' ? [] : ['front', 'back'].flatMap(zone => player[zone]
      .filter(card => !card.faceDown && isObCard(card))
      .map(card => ({ zone, underUid: card.uid })));
    // One option per empty slot, front first, lowest slot first. An area with no empty slot keeps one option with no slot:
    // choosing it is the forced placement that fails (the card goes to the trash), as before.
    const slots = ['front', 'back'].flatMap(zone => {
      const empty = vacantBoardSlots(player[zone], { controllerId: pending.playerId, zoneName: zone, limit: player.user?.[`${zone}Limit`] });
      return empty.length ? empty.map(slot => ({ zone, slot })) : [{ zone, slot: null }];
    });
    const destinations = [...slots, ...hosts];
    return {
      source: 'placement', playerId: pending.playerId, actorSeat,
      rawOptions: destinations,
      dto: {
        choiceId: choiceId(revision, 'placement'), kind: 'selection', presentationKey: pending.type, actorSeat,
        // The card being placed, so the chooser can see what goes on the board.
        ...(placing ? { placing: placedCardView(engineState, referenceState, metadata, actorSeat, placing) } : {}),
        optional: false, minimum: 1, maximum: 1,
        options: [
          ...slots.map(({ zone, slot }, index) => ({
            optionId: optionId(index), kind: 'destination', label: `${zone === 'front' ? 'フロント' : 'バック'}${slot ?? ''}`, zone, slot
          })),
          ...hosts.map((host, index) => ({
            optionId: optionId(slots.length + index), kind: 'destination', label: 'レイヤー配置',
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
