import { canActivateTurbo } from '../../engine.js';
import { ordinary, own, prepared, reject, selectedField } from './common.js';

export function turboEligibilityView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const active = own(engineState, 'active', code);
  if (!['player', 'ai'].includes(active)) reject(code);
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = own(player, 'user', code);
  ordinary(user, code);
  const abilityKey = selectedField(user, 'abilityKey', code, null);
  const turboUsed = selectedField(player, 'turboUsed', code);
  if ((abilityKey !== null && abilityKey !== undefined && typeof abilityKey !== 'string')
    || typeof turboUsed !== 'boolean') reject(code);
  return {
    active,
    players: { [playerId]: { user: { abilityKey: abilityKey ?? null }, turboUsed } }
  };
}

export function prepareActivateAbilityAction({ source, canonical, playerId }) {
  if (!canActivateTurbo(turboEligibilityView(source.engineState, playerId), playerId)) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, { engineFunction: 'activateTurbo', playerId });
}

export function prepareEndTurnAction({ canonical, playerId }) {
  return prepared(canonical, { engineFunction: 'endTurn', playerId });
}
