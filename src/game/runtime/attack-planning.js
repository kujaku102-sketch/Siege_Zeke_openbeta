import { canAttack, getAttackTargets } from '../engine.js';

export function attackOptions(context, attackerRef) {
  const source = context.resolve(attackerRef);
  if (!source || source.entry.location.kind !== 'board' || source.entry.location.zone !== 'front'
    || source.entry.controllerSeat !== context.viewerSeat || source.entry.location.seatId !== context.viewerSeat) return [];
  const view = context.view('attack');
  const attacker = view.players[context.playerId].front.find(card => card.uid === source.card.uid);
  if (!attacker || !canAttack(view, context.playerId, attacker)) return [];
  const opponentId = context.playerId === 'player' ? 'ai' : 'player';
  const opponentSeat = context.metadata.seatIds[opponentId === 'player' ? 0 : 1];
  return getAttackTargets(view, context.playerId, attacker).flatMap(target => {
    if (target.type === 'fortress') return [{ kind: 'user', seatId: opponentSeat }];
    const physical = context.state.players[opponentId].front.find(card => card.uid === target.uid);
    const cardRef = physical && context.refFor(physical);
    return cardRef ? [{ kind: 'card', cardRef }] : [];
  });
}

export function attackIntents(context) {
  return context.state.players[context.playerId].front.flatMap(card => {
    const attackerRef = context.refFor(card);
    return attackerRef && attackOptions(context, attackerRef).length ? [{
      kind: 'intent', actionType: 'attack', base: { attackerRef }, readiness: 'ready'
    }] : [];
  });
}

export function completeAttack(entry, target) {
  return { type: 'attack', attackerRef: entry.base.attackerRef, target };
}
