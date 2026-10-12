import { projectRuntimeView, inspectRuntimeCard } from '../game/runtime/projection.js';
import { buildRequiredInput } from '../game/runtime/required-input.js';
import { runtimeProgress } from '../game/runtime/public-result.js';
import { buildRuntimeLegalActions } from '../game/runtime/legal-actions.js';
import { queryRuntimeAction } from '../game/runtime/action-planning.js';
import { createRuntimeReadContext } from '../game/runtime/read-context.js';
import { submitRuntimeCommand } from '../game/runtime/transaction.js';
import { projectRuntimeEventBatch } from '../game/runtime/event-feed.js';
import { makeBoundCommand, validatePortBinding, validateStatusView } from './port-contract.js';

const failure = code => ({ ok: false, error: { code } });
const nonempty = value => typeof value === 'string' && value.length > 0;

function exactBindInput(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || keys[0] !== 'seatId') return null;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'seatId');
  return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') && nonempty(descriptor.value) ? descriptor.value : null;
}

function lockedOutcome(authority) {
  const outcome = authority.engineState.victory?.lockedOutcome ?? null;
  if (outcome === null) return null;
  if (outcome === 'draw') return { kind: 'draw' };
  const index = outcome === 'player' ? 0 : outcome === 'ai' ? 1 : -1;
  return index < 0 ? null : { kind: 'win', winnerSeat: authority.metadata.seatIds[index] };
}

function portQuery(authority, binding, modePolicy = null, input = undefined) {
  let inspectRef = null;
  if (input !== undefined) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 1) return failure('INVALID_QUERY_INPUT');
    const descriptor = Object.getOwnPropertyDescriptor(input,'inspectRef');
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value') || typeof descriptor.value !== 'string' || !/^r:[0-9a-f]{32}$/.test(descriptor.value)) return failure('INVALID_QUERY_INPUT');
    inspectRef = descriptor.value;
  }
  const readContext = createRuntimeReadContext(authority.engineState);
  const observation = projectRuntimeView(authority.engineState, authority.referenceState, {
    matchId: binding.matchId, viewerSeat: binding.seatId, revision: authority.revision
  }, readContext);
  if (!observation.ok) return failure(`PORT_QUERY_${observation.error.code}`);
  const requiredInput = buildRequiredInput(authority, binding.seatId);
  if (!requiredInput.ok) return failure(`PORT_QUERY_${requiredInput.error.code}`);
  const legalActions = buildRuntimeLegalActions(authority, binding.seatId, observation.value, requiredInput.value, readContext, modePolicy !== null);
  if (!legalActions.ok) return failure(`PORT_QUERY_${legalActions.error.code}`);
  const progress = runtimeProgress(authority.engineState);
  if (progress === 'awaitingInput' && requiredInput.value === null) return failure('PORT_QUERY_REQUIRED_INPUT_UNAVAILABLE');
  const status = {
    contractVersion: 1, matchId: binding.matchId, revision: authority.revision,
    viewerSeat: binding.seatId, activeSeat: observation.value.activeSeat, progress,
    lockedOutcome: lockedOutcome(authority), finished: authority.engineState.victory?.finished === true,
    requiredInput: requiredInput.value === null ? null : { kind: 'waiting', seatId: requiredInput.value.actorSeat },
    seats: observation.value.seats.map(seat => ({
      seatId: seat.seatId, deckCount: seat.deck.count, handCount: seat.hand.count
    }))
  };
  const validated = validateStatusView(binding, status);
  if (!validated.ok) return validated;
  let inspection;
  if (inspectRef !== null) {
    const read = inspectRuntimeCard(authority.engineState,authority.referenceState,{matchId:binding.matchId,viewerSeat:binding.seatId,revision:authority.revision},inspectRef,readContext);
    if (!read.ok) return failure('INSPECTION_NOT_ALLOWED');
    inspection = read.value;
  }
  return { ok: true, value: {
    status: validated.value, observation: observation.value,
    legalActions: legalActions.value, requiredInput: requiredInput.value,
    ...(inspection ? {inspection} : {})
  } };
}

function receiptFor(authority, binding, commandId) {
  if (!nonempty(commandId)) return failure('INVALID_RECEIPT_QUERY');
  const entry = authority.journal.entries.find(item => item.commandId === commandId && item.actorSeat === binding.seatId);
  return entry ? { ok: true, value: structuredClone(entry.receipt) } : failure('RECEIPT_NOT_FOUND');
}

export function createLocalRuntimeCoordinator(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    return failure('INVALID_LOCAL_RUNTIME');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length < 2 || keys.length > 3 || keys.some(key => typeof key !== 'string' || !['authority', 'sessionGeneration', 'modePolicy'].includes(key))) {
    return failure('INVALID_LOCAL_RUNTIME');
  }
  const authorityDescriptor = Object.getOwnPropertyDescriptor(input, 'authority');
  const generationDescriptor = Object.getOwnPropertyDescriptor(input, 'sessionGeneration');
  if (!authorityDescriptor?.enumerable || !Object.hasOwn(authorityDescriptor, 'value')
    || !generationDescriptor?.enumerable || !Object.hasOwn(generationDescriptor, 'value')) return failure('INVALID_LOCAL_RUNTIME');
  const generation = generationDescriptor.value;
  const policyDescriptor = Object.getOwnPropertyDescriptor(input, 'modePolicy');
  if (policyDescriptor && (!policyDescriptor.enumerable || !Object.hasOwn(policyDescriptor, 'value'))) return failure('INVALID_LOCAL_RUNTIME');
  const modePolicy = policyDescriptor?.value ?? null;
  if (modePolicy !== null && ['authorize', 'accepted'].some(key => {
    const method = Object.getOwnPropertyDescriptor(modePolicy, key);
    return !method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function';
  })) return failure('INVALID_LOCAL_RUNTIME');
  if (!Number.isSafeInteger(generation) || generation < 1 || Object.is(generation, -0)) return failure('INVALID_LOCAL_RUNTIME');
  let authority = authorityDescriptor.value;
  const metadataDescriptor = authority && typeof authority === 'object'
    ? Object.getOwnPropertyDescriptor(authority, 'metadata') : null;
  const metadata = metadataDescriptor?.enumerable && Object.hasOwn(metadataDescriptor, 'value') ? metadataDescriptor.value : null;
  const matchDescriptor = metadata && typeof metadata === 'object' ? Object.getOwnPropertyDescriptor(metadata, 'matchId') : null;
  const seatsDescriptor = metadata && typeof metadata === 'object' ? Object.getOwnPropertyDescriptor(metadata, 'seatIds') : null;
  const matchId = matchDescriptor?.enumerable && Object.hasOwn(matchDescriptor, 'value') ? matchDescriptor.value : null;
  const seatIds = seatsDescriptor?.enumerable && Object.hasOwn(seatsDescriptor, 'value') ? seatsDescriptor.value : null;
  if (!nonempty(matchId) || !Array.isArray(seatIds) || seatIds.length !== 2) return failure('INVALID_LOCAL_RUNTIME');
  let active = true;
  const ports = new Set();
  // Authority is replaced atomically by submit. Catalogs never survive that replacement.
  const catalogs = new Map();
  const eventFeeds = new Map(seatIds.map(id => [id, []]));
  const eventFaults = new Set();
  const sandboxActions = new Set(['sandboxAddCard', 'sandboxSelectActiveSeat']);
  const commit = (binding, intent, capability = false) => {
    if (!active) return failure('PORT_COORDINATOR_DISPOSED');
    const command = makeBoundCommand(binding, intent);
    if (!command.ok) return command;
    if (sandboxActions.has(command.value.action.type) && !capability) return failure('CAPABILITY_REQUIRED');
    if (capability && !sandboxActions.has(command.value.action.type)) return failure('ACTION_NOT_ALLOWED');
    const retry = receiptFor(authority, binding, command.value.commandId).ok;
    if (modePolicy && !retry) {
      const query = portQuery(authority, binding, modePolicy);
      if (!query.ok) return query;
      const allowed = modePolicy.authorize(query.value, command.value.action);
      if (!allowed.ok) return allowed;
    }
    const result = submitRuntimeCommand(authority, {
      matchId: binding.matchId, actorSeat: binding.seatId
    }, command.value, { tutorialAuthorized: modePolicy !== null });
    if (!result.ok) return result;
    if (result.value.kind === 'accepted') {
      for (const viewer of seatIds) {
        try {
          eventFeeds.get(viewer).push(...projectRuntimeEventBatch(
            authority, result.value.authority, command.value, result.value.receipt, viewer
          ));
        } catch { eventFaults.add(viewer); }
      }
    }
    authority = result.value.authority;
    catalogs.clear();
    if (modePolicy && result.value.kind === 'accepted') {
      const query = portQuery(authority, binding, modePolicy);
      if (query.ok) modePolicy.accepted(query.value, command.value.action);
    }
    return { ok: true, value: {
      kind: result.value.kind, receipt: structuredClone(result.value.receipt),
      result: structuredClone(result.value.publicResult)
    } };
  };
  const bind = bindInput => {
    if (!active) return failure('PORT_COORDINATOR_DISPOSED');
    const seatId = exactBindInput(bindInput);
    if (!seatId) return failure('INVALID_PORT_BINDING');
    const checked = validatePortBinding({
      contractVersion: 1, matchId, seatId,
      seatIds: [...seatIds], sessionGeneration: generation
    });
    if (!checked.ok) return checked;
    const binding = checked.value;
    const token = { disposed: false };
    ports.add(token);
    const usable = () => active && !token.disposed;
    const port = Object.freeze({
      query(input) {
        if (!usable()) return failure('PORT_DISPOSED');
        const result = portQuery(authority, binding, modePolicy,input);
        if (result.ok) catalogs.set(binding.seatId, {
          authority, actions: structuredClone(result.value.legalActions)
        });
        return result;
      },
      queryAction(input) {
        if (!usable()) return failure('PORT_DISPOSED');
        const catalog = catalogs.get(binding.seatId);
        return queryRuntimeAction(authority, binding.seatId, input,
          catalog?.authority === authority ? catalog.actions : null, modePolicy !== null);
      },
      submit(intent) {
        if (!usable()) return failure('PORT_DISPOSED');
        return commit(binding, intent);
      },
      receipt(commandId) {
        return usable() ? receiptFor(authority, binding, commandId) : failure('PORT_DISPOSED');
      },
      events(input = { afterEventId: null }) {
        if (!usable()) return failure('PORT_DISPOSED');
        if (eventFaults.has(binding.seatId)) return failure('EVENT_STREAM_UNAVAILABLE');
        if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype
          || Reflect.ownKeys(input).length !== 1) return failure('INVALID_EVENT_CURSOR');
        const cursor = Object.getOwnPropertyDescriptor(input, 'afterEventId');
        if (!cursor?.enumerable || !Object.hasOwn(cursor, 'value')
          || cursor.value !== null && !nonempty(cursor.value)) return failure('INVALID_EVENT_CURSOR');
        const feed = eventFeeds.get(binding.seatId);
        const index = cursor.value === null ? -1 : feed.findIndex(event => event.eventId === cursor.value);
        if (cursor.value !== null && index < 0) return failure('UNKNOWN_EVENT_CURSOR');
        return { ok: true, value: {
          cursor: feed.at(-1)?.eventId ?? null, events: structuredClone(feed.slice(index + 1))
        } };
      },
      dispose() {
        if (!token.disposed) { token.disposed = true; ports.delete(token); catalogs.delete(binding.seatId); }
        return { ok: true, value: null };
      }
    });
    return { ok: true, value: port };
  };
  return { ok: true, value: Object.freeze({
    bind,
    // The trusted factory receives this handle; bound seat ports do not.
    sandboxControl(seatId) {
      if (!active) return failure('PORT_COORDINATOR_DISPOSED');
      if (!['sandbox', 'lab'].includes(authority.engineState.mode)) return failure('CAPABILITY_REQUIRED');
      const binding = validatePortBinding({ contractVersion: 1, matchId, seatId,
        seatIds: [...seatIds], sessionGeneration: generation });
      if (!binding.ok) return binding;
      return { ok: true, value: Object.freeze({ submit: intent => commit(binding.value, intent, true) }) };
    },
    dispose() {
      active = false;
      for (const token of ports) token.disposed = true;
      ports.clear();
      catalogs.clear();
      eventFeeds.clear();
      eventFaults.clear();
      return { ok: true, value: null };
    }
  }) };
}
