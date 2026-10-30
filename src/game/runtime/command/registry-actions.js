import { currentReferencedCard } from './card-target.js';
import { ordinary, own, prepared, reject } from './common.js';

export function requireRegistryAction(engineState, playerId) {
  const players = own(engineState, 'players', 'INVALID_AUTHORITY');
  ordinary(players, 'INVALID_AUTHORITY');
  const player = own(players, playerId, 'INVALID_AUTHORITY');
  ordinary(player, 'INVALID_AUTHORITY');
  const used = own(player, 'registryActionUsed', 'INVALID_AUTHORITY');
  if (typeof used !== 'boolean') reject('INVALID_AUTHORITY');
  if (used) reject('ACTION_NOT_ALLOWED');
}

export function installTarget(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry } = target;
  if (entry.location.kind !== 'zone' || entry.location.zone !== 'hand'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

function recoverRegistryTarget(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry } = target;
  if (entry.location.kind !== 'zone' || entry.location.zone !== 'registry'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

export function prepareInstallAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  requireRegistryAction(source.engineState, playerId);
  const target = installTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat);
  return prepared(canonical, { engineFunction: 'installCard', playerId, uid: target.uid });
}

export function prepareRecoverRegistryAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  requireRegistryAction(source.engineState, playerId);
  const target = recoverRegistryTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat);
  return prepared(canonical, { engineFunction: 'recoverRegistryCard', playerId, uid: target.uid });
}
