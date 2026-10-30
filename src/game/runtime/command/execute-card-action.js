import { normalExecutionCheck } from '../../engine.js';
import { isObCard } from '../../card-types.js';
import { currentReferencedCard } from './card-target.js';
import { prepared, reject } from './common.js';
import { normalCardInView, normalPlanningView } from './normal-views.js';

function executeCardTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const target = currentReferencedCard(engineState, referenceInput, action.cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'zone' || entry.location.zone !== 'hand'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const stateView = normalPlanningView(engineState);
  const cardView = normalCardInView(stateView, target.uid);
  if (!cardView || !(isObCard(cardView) || ['Code', 'Script'].includes(cardView.category))
    || cardView.category === 'Script' && action.destination.zone !== 'back') reject('ACTION_NOT_ALLOWED');
  const options = { zone: action.destination.zone, requestedSlot: action.destination.slot };
  if (!normalExecutionCheck(stateView, playerId, cardView, options).ok) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid, options };
}

export function prepareExecuteCardAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = executeCardTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, { engineFunction: 'playCard', playerId, uid: target.uid, options: target.options });
}
