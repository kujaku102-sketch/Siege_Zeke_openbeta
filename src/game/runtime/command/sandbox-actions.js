import { canAddSandboxCardToHand } from '../../engine.js';
import { ordinary, own, prepared, reject } from './common.js';

function sandboxAddEligibilityView(engineState, mode, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  return { mode, players: { [playerId]: {} } };
}

export function prepareSandboxAddAction({ source, engine, metadata, canonical }) {
  if (!['lab', 'sandbox'].includes(engine.mode)) reject('UNAVAILABLE_MODE');
  if (engine.hasResult || engine.busy) reject('ACTION_NOT_ALLOWED');
  const targetIndex = metadata.seatIds.indexOf(canonical.value.command.action.targetSeat);
  if (targetIndex < 0) reject('ACTION_NOT_ALLOWED');
  const targetPlayerId = targetIndex === 0 ? 'player' : 'ai';
  if (!canAddSandboxCardToHand(
    sandboxAddEligibilityView(source.engineState, engine.mode, targetPlayerId),
    targetPlayerId,
    canonical.value.command.action.definitionId
  )) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, {
    engineFunction: 'addSandboxCardToHand', playerId: targetPlayerId,
    cardId: canonical.value.command.action.definitionId
  });
}

export function prepareSandboxSelectAction({ engine, metadata, canonical }) {
  if (engine.mode !== 'sandbox') reject('UNAVAILABLE_MODE');
  if (engine.hasResult || engine.busy) reject('ACTION_NOT_ALLOWED');
  const index = metadata.seatIds.indexOf(canonical.value.command.action.targetSeat);
  if (index < 0) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, { engineFunction: 'selectSandboxActiveSeat', playerId: index === 0 ? 'player' : 'ai' });
}
