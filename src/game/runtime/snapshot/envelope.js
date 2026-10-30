import { FORMAT_ERROR, INVALID, dense, exact, ordinary, own, reject } from './guards.js';

export const FORMAT = 'siege-zeke.authority-snapshot';
export const SNAPSHOT_KEYS = ['format', 'schemaVersion', 'metadata', 'revision', 'engineState', 'referenceState'];

export function snapshotEnvelope(input) {
  if (input === null || (typeof input !== 'object')) reject(INVALID);
  if (Array.isArray(input)) {
    dense(input, INVALID);
    reject(FORMAT_ERROR);
  }
  ordinary(input, INVALID);
  const keys = Reflect.ownKeys(input);
  for (const key of keys) {
    if (typeof key !== 'string') reject(INVALID);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(INVALID);
  }
  if (!keys.includes('format')) reject(FORMAT_ERROR);
  const format = own(input, 'format', INVALID);
  if (typeof format !== 'string') reject(INVALID);
  if (format !== FORMAT) reject(FORMAT_ERROR);
  if (!keys.includes('schemaVersion')) reject(INVALID);
  const schemaVersion = own(input, 'schemaVersion', INVALID);
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || Object.is(schemaVersion, -0) || schemaVersion < 0) reject(INVALID);
  if (schemaVersion !== 1) reject(FORMAT_ERROR);
  return exact(input, SNAPSHOT_KEYS, INVALID);
}
