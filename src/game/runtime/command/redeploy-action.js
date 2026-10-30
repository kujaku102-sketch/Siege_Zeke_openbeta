import { canDirectRelogAtSlot, relogPreparationKind } from '../../engine.js';
import { currentReferencedCard } from './card-target.js';
import { prepared, reject, selectedArray, selectedField, selectedObject } from './common.js';
import { executionCardView, executionPlanningView } from './execution-views.js';
import { normalPlanningView } from './normal-views.js';

export function selectedLayerCount(card, code, ancestors = new Set()) {
  const mounted = selectedField(card, 'mounted', code, []);
  return selectedArray(mounted, code, ancestors, layer => {
    selectedObject(layer, code, ancestors);
    try { return 1 + selectedLayerCount(layer, code, ancestors); }
    finally { ancestors.delete(layer); }
  }).reduce((sum, count) => sum + count, 0);
}

function redeployTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const target = currentReferencedCard(engineState, referenceInput, action.cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'board' || !['front', 'back'].includes(entry.location.zone)
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat
    || action.destination.zone === entry.location.zone) reject('ACTION_NOT_ALLOWED');
  const cardView = executionCardView(card);
  const layerCount = selectedLayerCount(card, 'INVALID_AUTHORITY');
  // Re-executing onto a Code names that Code; the host is checked in the uid-bearing planning view.
  const hostRef = action.destination.hostRef ?? null;
  let baseUid = null;
  if (hostRef !== null) {
    const host = currentReferencedCard(engineState, referenceInput, hostRef, metadata, actorSeat);
    if (host.entry.location.kind !== 'board' || host.entry.location.seatId !== actorSeat || host.entry.controllerSeat !== actorSeat
      || host.entry.location.zone !== action.destination.zone) reject('ACTION_NOT_ALLOWED');
    baseUid = host.uid;
  }
  const stateView = baseUid === null ? executionPlanningView(engineState) : normalPlanningView(engineState);
  const options = {
    sourceZone: entry.location.zone,
    zone: action.destination.zone === 'registry' ? entry.location.zone === 'front' ? 'back' : 'front' : action.destination.zone,
    requestedSlot: action.destination.zone === 'registry' || baseUid !== null ? null : action.destination.slot,
    layerCount, baseUid
  };
  if ((relogPreparationKind(cardView, layerCount) === 'registry') !== (action.destination.zone === 'registry')) reject('ACTION_NOT_ALLOWED');
  if (!canDirectRelogAtSlot(stateView, playerId, cardView, options).ok) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid, targetZone: options.zone,
    options: baseUid === null ? { requestedSlot: options.requestedSlot } : { requestedSlot: null, baseUid } };
}

export function prepareRedeployAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = redeployTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, {
    engineFunction: 'relogCard', playerId, uid: target.uid,
    targetZone: target.targetZone, options: target.options
  });
}
