import { validateLiveAuthority } from '../game/runtime/live-authority.js';
import { canonicalizeCommand, createCommandJournal } from '../game/runtime/command-record.js';
import { buildRuntimeReferenceFrame } from '../game/runtime/reference-frame.js';
import { createRuntimeReferenceState, planRuntimeReferenceCreation } from '../game/runtime/references.js';
import { createRuntimeReferenceTokens } from '../game/runtime/reference-token.js';
import { createRuntimeSession } from '../game/runtime/session.js';
import { createLocalRuntimeCoordinator } from './local-runtime-port.js';
import { createTutorialModeController, tutorialStateData } from './tutorial-mode-controller.js';

const failure = code => ({ ok: false, error: { code } });
const nonempty = value => typeof value === 'string' && value.length > 0;

function exactInput(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  // `tutorialState` is optional: the guide's progress of a tutorial match started from a stored snapshot.
  if (keys.some(key => typeof key !== 'string' || !['authority', 'sessionGeneration', 'tutorialState'].includes(key))
    || !['authority', 'sessionGeneration'].every(key => keys.includes(key)) || keys.length > 3) return null;
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function intentInput(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 3 || keys.some(key => typeof key !== 'string'
    || !['commandId', 'expectedRevision', 'action'].includes(key))) return null;
  const result = {};
  for (const key of ['commandId', 'expectedRevision', 'action']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function authorityMetadata(authority) {
  const descriptor = authority && typeof authority === 'object'
    ? Object.getOwnPropertyDescriptor(authority, 'metadata') : null;
  const metadata = descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  const match = metadata && typeof metadata === 'object' ? Object.getOwnPropertyDescriptor(metadata, 'matchId') : null;
  const seats = metadata && typeof metadata === 'object' ? Object.getOwnPropertyDescriptor(metadata, 'seatIds') : null;
  const matchId = match?.enumerable && Object.hasOwn(match, 'value') ? match.value : null;
  const seatIds = seats?.enumerable && Object.hasOwn(seats, 'value') ? seats.value : null;
  return nonempty(matchId) && Array.isArray(seatIds) && seatIds.length === 2
    ? { matchId, seatIds: [...seatIds] } : null;
}

function clone(value) { return structuredClone(value); }

export function createMatchSessionController(input) {
  const config = exactInput(input);
  if (!config || !Number.isSafeInteger(config.sessionGeneration) || config.sessionGeneration < 1
    || Object.is(config.sessionGeneration, -0)) return failure('INVALID_MATCH_SESSION');
  const validatedAuthority = validateLiveAuthority(config.authority);
  if (!validatedAuthority.ok) return failure('INVALID_MATCH_SESSION');
  const startOptions = config.authority.metadata.startOptions;
  const tutorialState = Object.hasOwn(config, 'tutorialState')
    ? (startOptions.mode === 'tutorial' ? tutorialStateData(startOptions.tutorialId, config.tutorialState) : null) : undefined;
  if (tutorialState === null) return failure('INVALID_MATCH_SESSION');
  const modePolicy = startOptions.mode === 'tutorial'
    ? createTutorialModeController(startOptions.tutorialId, tutorialState ?? null) : null;
  const coordinator = createLocalRuntimeCoordinator({
    authority: config.authority, sessionGeneration: config.sessionGeneration, modePolicy
  });
  if (!coordinator.ok) return failure(`MATCH_SESSION_${coordinator.error.code}`);
  const metadata = authorityMetadata(config.authority);
  if (!metadata) {
    coordinator.value.dispose();
    return failure('INVALID_MATCH_SESSION');
  }

  let active = true;
  let commandSerial = 0;
  let latestAdoptedRevision = -1;
  const eventCursors = new Map();
  const tracked = new Set();
  const clients = new Map();
  const controls = new Map();
  const readStates = new Map();

  const usable = () => active;

  for (const [seatIndex, seatId] of metadata.seatIds.entries()) {
    const bound = coordinator.value.bind({ seatId });
    if (!bound.ok) {
      coordinator.value.dispose();
      return failure(`MATCH_SESSION_${bound.error.code}`);
    }
    const port = bound.value;
    let disposed = false;
    let latestQuery = null;
    let latestRevision = -1;
    let adoptedModeEpoch = -1;
    let uncertain = null;
    const operations = new Map();
    const semanticOperations = new Map();

    const clientUsable = () => usable() && !disposed;
    const adoptQuery = result => {
      if (!result.ok) return result;
      const status = result.value?.status;
      if (status?.matchId !== metadata.matchId || status?.viewerSeat !== seatId
        || !Number.isSafeInteger(status?.revision) || status.revision < latestRevision
        || status.revision < latestAdoptedRevision) {
        return failure('MATCH_SESSION_STALE_RESULT');
      }
      latestRevision = status.revision;
      latestAdoptedRevision = status.revision;
      const {inspection,...base} = result.value;
      latestQuery = clone(base);
      adoptedModeEpoch = coordinator.value.readStamp().value.modeEpoch;
      return { ok: true, value: { ...clone(latestQuery), ...(inspection ? {inspection:clone(inspection)} : {}) } };
    };

    const implementation = {
      query(input) {
        if (!clientUsable()) return failure('MATCH_SESSION_DISPOSED');
        return adoptQuery(port.query(input));
      },
      queryAction(input) {
        if (!clientUsable()) return failure('MATCH_SESSION_DISPOSED');
        return port.queryAction(input);
      },
      submit(inputIntent, controlPort = null) {
        if (!clientUsable()) return failure('MATCH_SESSION_DISPOSED');
        const intent = intentInput(inputIntent);
        if (!intent || !nonempty(intent.commandId)) return failure('INVALID_SESSION_INTENT');
        let operation = operations.get(intent.commandId) ?? null;
        const channel = controlPort ? 'sandbox-control' : 'seat';
        if (operation && operation.channel !== channel) return failure('MATCH_SESSION_COMMAND_COLLISION');
        const runtimeCommandId = operation?.runtimeCommandId
          ?? `command:${config.sessionGeneration}:${seatIndex + 1}:${commandSerial + 1}`;
        const canonical = canonicalizeCommand({
          contractVersion: 1, matchId: metadata.matchId, commandId: runtimeCommandId,
          actorSeat: seatId, expectedRevision: intent.expectedRevision, action: intent.action
        });
        if (!canonical.ok) return failure('INVALID_SESSION_INTENT');
        if (operation) {
          if (operation.canonicalPayload !== canonical.value.canonicalPayload) {
            return failure('MATCH_SESSION_COMMAND_COLLISION');
          }
          if (operation.result !== null) return clone(operation.result);
          if (uncertain !== operation) return failure('MATCH_SESSION_COMMAND_INFLIGHT');
        } else {
          const semanticKey = JSON.stringify({
            channel,
            expectedRevision: canonical.value.command.expectedRevision,
            action: canonical.value.command.action
          });
          operation = semanticOperations.get(semanticKey) ?? null;
          if (operation) {
            operations.set(intent.commandId, operation);
            if (operation.result !== null) return clone(operation.result);
            if (uncertain !== operation) return failure('MATCH_SESSION_COMMAND_INFLIGHT');
          } else {
            if (uncertain !== null) return failure('MATCH_SESSION_COMMAND_INFLIGHT');
            commandSerial += 1;
            operation = {
              channel,
              runtimeCommandId, canonicalPayload: canonical.value.canonicalPayload,
              semanticKey, result: null
            };
            operations.set(intent.commandId, operation);
            semanticOperations.set(semanticKey, operation);
            uncertain = operation;
          }
        }
        let result;
        try {
          result = (controlPort ?? port).submit({
            commandId: operation.runtimeCommandId,
            expectedRevision: canonical.value.command.expectedRevision,
            action: canonical.value.command.action
          });
          if (!result.ok) {
            // A returned local refusal is known not to have committed. Only a
            // thrown/uncertain transport outcome retains the inflight lock.
            uncertain = null;
            semanticOperations.delete(operation.semanticKey);
            for (const [id, item] of operations) if (item === operation) operations.delete(id);
            return result;
          }
          operation.result = clone(result);
          uncertain = null;
        } catch (error) {
          uncertain = operation;
          throw error;
        }
        latestQuery = null;
        const refreshed = adoptQuery(port.query());
        if (!refreshed.ok) return refreshed;
        return clone(operation.result);
      },
      receipt(clientCommandId) {
        if (!clientUsable()) return failure('MATCH_SESSION_DISPOSED');
        const operation = operations.get(clientCommandId);
        return operation ? port.receipt(operation.runtimeCommandId) : failure('RECEIPT_NOT_FOUND');
      },
      events(cursor = { afterEventId: null }) {
        return clientUsable() ? port.events(cursor) : failure('MATCH_SESSION_DISPOSED');
      },
      latest() {
        if (!clientUsable()) return failure('MATCH_SESSION_DISPOSED');
        const stamp = coordinator.value.readStamp();
        return latestQuery === null ? failure('MATCH_SESSION_QUERY_UNAVAILABLE')
          : !stamp.ok || latestRevision !== stamp.value.currentRevision || adoptedModeEpoch !== stamp.value.modeEpoch
            || latestRevision < latestAdoptedRevision ? failure('MATCH_SESSION_STALE_RESULT')
          : { ok: true, value: clone(latestQuery) };
      },
      dispose() {
        if (!disposed) { disposed = true; port.dispose(); }
        return { ok: true, value: null };
      }
    };
    const sessionPort = Object.freeze({ ...implementation, submit: intent => implementation.submit(intent) });
    clients.set(seatId, sessionPort);
    readStates.set(seatId, () => ({ adoptedRevision: latestRevision, adoptedModeEpoch,
      available: clientUsable() && latestQuery !== null }));
    const control = coordinator.value.sandboxControl(seatId);
    if (control.ok) controls.set(seatId, Object.freeze({
      submit: intent => implementation.submit(intent, control.value)
    }));
  }

  return { ok: true, value: Object.freeze({
    scope() {
      return { matchId: metadata.matchId, sessionGeneration: config.sessionGeneration, seatIds: [...metadata.seatIds] };
    },
    tutorial() {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      return modePolicy ? { ok: true, value: modePolicy.presentation() } : failure('UNAVAILABLE_MODE');
    },
    // The guide's progress as the five items a stored snapshot keeps (tutorial-mode-controller.js).
    tutorialState() {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      return modePolicy ? { ok: true, value: modePolicy.state() } : failure('UNAVAILABLE_MODE');
    },
    advanceTutorial() {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      if (!modePolicy) return failure('UNAVAILABLE_MODE');
      const result = modePolicy.advance();
      if (result.ok) coordinator.value.invalidateMode();
      return result;
    },
    readStamp(viewerSeat) {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      const read = readStates.get(viewerSeat);
      if (!read) return failure('MATCH_SESSION_UNKNOWN_SEAT');
      const current = coordinator.value.readStamp();
      if (!current.ok) return current;
      const adopted = read();
      return { ok: true, value: { ...current.value, viewerSeat, ...adopted,
        available: adopted.available && adopted.adoptedRevision === current.value.currentRevision
          && adopted.adoptedModeEpoch === current.value.modeEpoch } };
    },
    matchRecord() {
      return usable() ? coordinator.value.matchRecord() : failure('MATCH_SESSION_DISPOSED');
    },
    port(seatId) {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      const port = clients.get(seatId);
      return port ? { ok: true, value: port } : failure('MATCH_SESSION_UNKNOWN_SEAT');
    },
    sandboxControl(seatId = metadata.seatIds[0]) {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      const control = controls.get(seatId);
      return control ? { ok: true, value: control } : failure('CAPABILITY_REQUIRED');
    },
    takeEvents(viewerSeat = metadata.seatIds[0]) {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      const client = clients.get(viewerSeat);
      if (!client) return failure('MATCH_SESSION_UNKNOWN_SEAT');
      const result = client.events({ afterEventId: eventCursors.get(viewerSeat) ?? null });
      if (!result.ok) return result;
      eventCursors.set(viewerSeat, result.value.cursor);
      return { ok: true, value: result.value.events };
    },
    track(disposable) {
      if (!usable()) return failure('MATCH_SESSION_DISPOSED');
      const descriptor = disposable && typeof disposable === 'object'
        ? Object.getOwnPropertyDescriptor(disposable, 'dispose') : null;
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
        return failure('INVALID_SESSION_DISPOSABLE');
      }
      tracked.add(disposable);
      return { ok: true, value: null };
    },
    dispose() {
      if (active) {
        active = false;
        let firstError = null;
        for (const disposable of [...tracked].reverse()) {
          try { disposable.dispose(); }
          catch (error) { firstError ??= error; }
        }
        tracked.clear();
        for (const client of clients.values()) {
          try { client.dispose(); }
          catch (error) { firstError ??= error; }
        }
        try { coordinator.value.dispose(); }
        catch (error) { firstError ??= error; }
        eventCursors.clear();
        controls.clear();
        modePolicy?.dispose();
        if (firstError) throw firstError;
      }
      return { ok: true, value: null };
    }
  }) };
}

export function createNewMatchSessionController(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    return failure('INVALID_NEW_MATCH_SESSION');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string'
    || !['runtimeConfig', 'sessionGeneration'].includes(key))) return failure('INVALID_NEW_MATCH_SESSION');
  const runtime = Object.getOwnPropertyDescriptor(input, 'runtimeConfig');
  const generation = Object.getOwnPropertyDescriptor(input, 'sessionGeneration');
  if (!runtime?.enumerable || !Object.hasOwn(runtime, 'value')
    || !generation?.enumerable || !Object.hasOwn(generation, 'value')
    || !Number.isSafeInteger(generation.value) || generation.value < 1 || Object.is(generation.value, -0)) {
    return failure('INVALID_NEW_MATCH_SESSION');
  }
  const authority = createMatchAuthority(runtime.value);
  if (!authority.ok) return authority;
  return createMatchSessionController({ authority: authority.value, sessionGeneration: generation.value });
}

// A fresh match's whole authority: engine, card references and an empty journal.
export function createMatchAuthority(runtimeConfig) {
  const session = createRuntimeSession(runtimeConfig);
  if (!session.ok) return session;
  const frame = buildRuntimeReferenceFrame(session.value.engineState);
  if (!frame.ok) return frame;
  const planned = planRuntimeReferenceCreation(frame.value);
  if (!planned.ok) return planned;
  const tokens = createRuntimeReferenceTokens({ count: planned.value.newRefCount, issuedRefs: [] });
  if (!tokens.ok) return tokens;
  const references = createRuntimeReferenceState({ frame: frame.value, newRefs: tokens.value });
  if (!references.ok) return references;
  const journal = createCommandJournal({
    matchId: session.value.metadata.matchId, seatIds: session.value.metadata.seatIds
  });
  if (!journal.ok) return journal;
  return { ok: true, value: { ...session.value, referenceState: references.value, journal: journal.value } };
}
