import { projectRuntimeView } from './projection.js';
import { runtimePlanningReads } from './command-bridge.js';
import { buildRequiredInput } from './required-input.js';

// This is an output projector, not a second rules engine. Never copy an engine
// event wholesale: its UID, target, continuation and private payload are local.
function publicCards(authority, viewerSeat) {
  const view = projectRuntimeView(authority.engineState, authority.referenceState, {
    matchId: authority.metadata.matchId, viewerSeat, revision: authority.revision
  });
  if (!view.ok) throw new Error(view.error.code);
  const byRef = new Map();
  const visit = card => {
    byRef.set(card.cardRef, card);
    if (!card.faceDown) card.mounted.forEach(visit);
  };
  for (const seat of view.value.seats) {
    for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) seat[zone].cards.forEach(visit);
    seat.hand.cards?.forEach(visit);
  }
  const physical = runtimePlanningReads.physicalCardMap(authority.engineState);
  const referenceEntries = new Map(authority.referenceState.entries
    .filter(item => item.viewerSeat === viewerSeat).map(item => [item.identity.instanceId, item.cardRef]));
  const byUid = new Map();
  // Reference storage is deliberately read only inside the runtime boundary.
  for (const [instanceId, physicalCard] of physical) {
    const ref = referenceEntries.get(instanceId);
    const card = byRef.get(ref);
    if (card) byUid.set(physicalCard.uid, card);
  }
  return { view: view.value, byUid };
}

function cardSummary(card) {
  if (!card) return null;
  return card.faceDown ? { kind: 'card', cardRef: card.cardRef, faceDown: true }
    : { kind: 'card', cardRef: card.cardRef, faceDown: false,
      definitionId: card.definition.id, name: card.definition.name };
}

export function projectRuntimeEventBatch(before, after, command, receipt, viewerSeat) {
  const first = publicCards(before, viewerSeat);
  const last = publicCards(after, viewerSeat);
  const seat = id => id === 'player' ? after.metadata.seatIds[0]
    : id === 'ai' ? after.metadata.seatIds[1] : null;
  const known = uid => last.byUid.get(uid) ?? first.byUid.get(uid);
  const subject = uid => cardSummary(known(uid));
  const sourceRef = command.action.cardRef ?? command.action.attackerRef;
  const sourceIdentity = before.referenceState.entries.find(entry => entry.viewerSeat === command.actorSeat
    && entry.cardRef === sourceRef)?.identity.instanceId;
  const sourceUid = sourceIdentity
    ? runtimePlanningReads.physicalCardMap(before.engineState).get(sourceIdentity)?.uid : null;
  const actionSource = sourceUid ? known(sourceUid) : null;
  const events = [];
  const emit = (type, fields = {}) => events.push({
    eventId: `event:${receipt.revision}:${receipt.commandId}:${events.length}`,
    type, revision: receipt.revision, commandId: receipt.commandId,
    turnNumber: last.view.turnNumber, actorSeat: command.actorSeat, ...fields
  });
  // Opponent installing a private hand card does not disclose its identity.
  emit('action_committed', { actionType: command.action.type,
    source: cardSummary(actionSource) });
  const fresh = (after.engineState.events ?? []).filter(event => {
    const serial = Number(String(event.id).replace(/^EV-/, ''));
    return Number.isSafeInteger(serial) && serial > (before.engineState.triggerSerial ?? 0);
  });
  for (const event of fresh) {
    const actorSeat = seat(event.playerId) ?? command.actorSeat;
    const turnNumber = event.turnNumber ?? last.view.turnNumber;
    const card = subject(event.cardUid);
    if (event.type === 'turn_started') emit('turn_started', { actorSeat, turnNumber });
    else if (event.type === 'attack_declared') {
      const target = subject(event.targetUid) ?? (['player-fortress', 'ai-fortress'].includes(event.targetUid)
        ? { kind: 'user', seatId: after.metadata.seatIds.find(id => id !== actorSeat) } : null);
      if (card) emit('attack_declared', { actorSeat, turnNumber, source: card, target });
    } else if (event.type === 'combat_resolved' && card) {
      emit('combat_resolved', { actorSeat, turnNumber, source: card, target: subject(event.targetUid),
        damage: event.damage, counterDamage: event.counterDamage,
        sourceStrBefore: event.sourceStrBefore, sourceStrAfter: event.sourceStrAfter,
        targetStrBefore: event.targetStrBefore, targetStrAfter: event.targetStrAfter });
    } else if (event.type === 'card_damaged' && card) {
      emit('card_damaged', { actorSeat: seat(event.sourcePlayerId) ?? command.actorSeat,
        turnNumber, source: subject(event.sourceUid),
        target: card, amount: event.amount, before: event.strBefore, after: event.strAfter });
    } else if (event.type === 'user_damaged') {
      emit('user_damaged', { actorSeat: seat(event.sourcePlayerId) ?? command.actorSeat,
        turnNumber, source: subject(event.sourceUid),
        target: { kind: 'user', seatId: actorSeat }, amount: event.amount,
        before: event.strBefore, after: event.strAfter });
    } else if (event.type === 'card_destroyed' && card) {
      emit('card_destroyed', { actorSeat, turnNumber, target: card });
    } else if (event.type === 'user_ability_feedback') {
      const projectTarget = target => {
        if (!target) return null;
        const seatId = seat(target.playerId);
        if (!seatId) return null;
        if (target.kind === 'card_stat') {
          const summary = subject(target.cardUid);
          return summary && !summary.faceDown ? { ...summary, seatId, metric: target.metric } : null;
        }
        if (target.kind === 'player_stat') return { kind: target.kind, seatId, metric: target.metric };
        if (target.kind === 'zone_count') return { kind: target.kind, seatId, zone: target.zone };
        if (target.kind === 'status') return { kind: target.kind, seatId, status: target.status };
        return null;
      };
      const steps = (event.steps ?? []).flatMap(step => {
        if (step.kind === 'transfer') {
          const from = projectTarget(step.from), to = projectTarget(step.to);
          return from && to ? [{ kind: step.kind, from, to, count: step.count }] : [];
        }
        const target = projectTarget(step.target);
        return target ? [{ kind: step.kind, target, before: step.before, after: step.after,
          ...(step.kind === 'multiply' ? { factor: step.factor } : {}) }] : [];
      });
      if (steps.length) emit('user_ability_feedback', {
        actorSeat: seat(event.ownerPlayerId), affectedSeat: seat(event.affectedPlayerId),
        abilityKey: event.abilityKey, branch: event.branch, steps
      });
    }
  }
  for (const [uid, card] of last.byUid) {
    const previous = first.byUid.get(uid);
    if (!previous) {
      emit('card_moved', { source: null, target: cardSummary(card),
        from: { kind: 'unobserved' }, to: card.location });
      continue;
    }
    if (JSON.stringify(previous.location) !== JSON.stringify(card.location)) {
      emit('card_moved', { source: cardSummary(previous), target: cardSummary(card),
        from: previous.location, to: card.location });
    }
    if (card.faceDown || previous.faceDown) continue;
    for (const metric of ['currentAtk', 'currentStr', 'currentCost']) {
      if (card.computed[metric] !== previous.computed[metric]) emit('stat_changed', {
        target: cardSummary(card), metric, before: previous.computed[metric], after: card.computed[metric]
      });
    }
  }
  for (const [uid, previous] of first.byUid) {
    if (!last.byUid.has(uid)) emit('card_moved', { source: cardSummary(previous), target: null,
      from: previous.location, to: { kind: 'unobserved' } });
  }
  const oldChoice = buildRequiredInput(before, viewerSeat);
  const newChoice = buildRequiredInput(after, viewerSeat);
  if (!oldChoice.ok || !newChoice.ok) throw new Error('EVENT_REQUIRED_INPUT_UNAVAILABLE');
  if (oldChoice.value?.choiceId !== newChoice.value?.choiceId) {
    if (oldChoice.value) emit('choice_resolved', { actorSeat: oldChoice.value.actorSeat,
      choiceId: oldChoice.value.choiceId });
    if (newChoice.value) emit('choice_required', { actorSeat: newChoice.value.actorSeat,
      choiceId: newChoice.value.choiceId });
  }
  const outcome = () => after.engineState.victory.lockedOutcome === 'draw' ? { kind: 'draw' }
    : { kind: 'win', winnerSeat: seat(after.engineState.victory.lockedOutcome) };
  if (!before.engineState.victory?.lockedOutcome && after.engineState.victory?.lockedOutcome) {
    emit('result_locked', { outcome: outcome() });
  }
  if (!before.engineState.victory?.finished && after.engineState.victory?.finished) {
    emit('result_finished', { outcome: outcome() });
  }
  return events;
}
