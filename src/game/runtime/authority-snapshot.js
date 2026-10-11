import { validateCommandJournal } from './command-record.js';
import { createRuntimeSnapshot, restoreRuntimeSnapshot } from './snapshot.js';

const FORMAT = 'siege-zeke.command-authority-snapshot';
const KEYS = ['format', 'schemaVersion', 'runtime', 'journal'];
const AUTHORITY_KEYS = ['metadata', 'revision', 'engineState', 'referenceState', 'journal'];
const failure = code => ({ ok: false, error: { code } });

function exact(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

export function createRuntimeAuthoritySnapshot(authority) {
  const source = exact(authority, AUTHORITY_KEYS);
  if (!source) return failure('AUTHORITY_SNAPSHOT_INVALID_INPUT');
  const runtime = createRuntimeSnapshot({
    metadata: source.metadata, revision: source.revision,
    engineState: source.engineState, referenceState: source.referenceState
  });
  if (!runtime.ok) return runtime;
  const journal = validateCommandJournal(source.journal);
  if (!journal.ok) return journal;
  if (journal.value.matchId !== runtime.value.metadata.matchId
    || journal.value.seatIds.length !== runtime.value.metadata.seatIds.length
    || journal.value.seatIds.some((seat, index) => seat !== runtime.value.metadata.seatIds[index])) {
    return failure('AUTHORITY_SNAPSHOT_SCOPE_MISMATCH');
  }
  return { ok: true, value: {
    format: FORMAT, schemaVersion: 1, runtime: runtime.value, journal: journal.value
  } };
}

export function restoreRuntimeAuthoritySnapshot(snapshot, expected) {
  const source = exact(snapshot, KEYS);
  if (!source || source.format !== FORMAT || source.schemaVersion !== 1) {
    return failure('AUTHORITY_SNAPSHOT_UNSUPPORTED_FORMAT');
  }
  const runtime = restoreRuntimeSnapshot(source.runtime, expected);
  if (!runtime.ok) return runtime;
  const journal = validateCommandJournal(source.journal);
  if (!journal.ok) return journal;
  if (journal.value.matchId !== runtime.value.metadata.matchId
    || journal.value.seatIds.length !== runtime.value.metadata.seatIds.length
    || journal.value.seatIds.some((seat, index) => seat !== runtime.value.metadata.seatIds[index])) {
    return failure('AUTHORITY_SNAPSHOT_SCOPE_MISMATCH');
  }
  return { ok: true, value: { ...runtime.value, journal: journal.value } };
}
