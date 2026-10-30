import { cardHasKeyword } from '../../engine.js';
import { isObCard } from '../../card-types.js';
import { currentReferencedCard } from './card-target.js';
import { own, prepared, reject } from './common.js';
import { securityEligibilityView } from './security-view.js';

function restSecurityTarget(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'board' || entry.location.zone !== 'front'
    || entry.controllerSeat !== actorSeat || entry.location.seatId !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const faceDown = own(card, 'faceDown', 'INVALID_AUTHORITY');
  const asleep = own(card, 'sleep', 'INVALID_AUTHORITY');
  if (typeof faceDown !== 'boolean' || typeof asleep !== 'boolean') reject('INVALID_AUTHORITY');
  const view = securityEligibilityView(card);
  if (faceDown || asleep || !isObCard(view) || !cardHasKeyword(view, 'SECURITY')) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

export function prepareRestSecurityAction({ source, engine, metadata, trusted, canonical, playerId, readReferenceState }) {
  if (engine.securityRestWindow !== playerId) reject('ACTION_NOT_ALLOWED');
  const target = restSecurityTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat);
  return prepared(canonical, { engineFunction: 'restSecurity', playerId, uid: target.uid });
}
