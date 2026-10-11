import { projectRuntimeView } from './projection.js';
import { buildRequiredInput } from './required-input.js';

const failure = code => ({ ok: false, error: { code } });

export function runtimeProgress(engineState) {
  if (engineState?.victory?.finished === true) return 'finished';
  if (engineState?.victory?.lockedOutcome) return 'resultLocked';
  if (engineState?.pending !== null || engineState?.prompt !== null
    || engineState?.effectResolution?.status === 'awaiting-choice'
    || engineState?.securityRestWindow !== undefined && engineState.securityRestWindow !== null) {
    return 'awaitingInput';
  }
  return 'ready';
}

function eventId(receipt) {
  return `event:${receipt.revision}:${receipt.commandId}:0`;
}

export function buildRuntimePublicResult(authority, command, receipt, { retry = false } = {}) {
  const projected = projectRuntimeView(authority.engineState, authority.referenceState, {
    matchId: receipt.matchId,
    viewerSeat: command.actorSeat,
    revision: authority.revision
  });
  if (!projected.ok) return failure(`PUBLIC_RESULT_${projected.error.code}`);
  const requiredInput = buildRequiredInput(authority, command.actorSeat);
  if (!requiredInput.ok) return requiredInput;
  const progress = runtimeProgress(authority.engineState);
  if (progress === 'awaitingInput' && requiredInput.value === null) {
    return failure('PUBLIC_RESULT_REQUIRED_INPUT_UNAVAILABLE');
  }
  const accepted = receipt.status === 'accepted';
  const eventIds = accepted ? [eventId(receipt)] : [];
  const events = accepted && !retry ? [{
    eventId: eventIds[0],
    type: 'action_committed',
    revision: receipt.revision,
    commandId: receipt.commandId,
    actorSeat: command.actorSeat,
    actionType: command.action.type
  }] : [];
  return { ok: true, value: {
    receipt: { ...receipt, progress, eventIds },
    view: projected.value,
    requiredInput: requiredInput.value,
    events
  } };
}
