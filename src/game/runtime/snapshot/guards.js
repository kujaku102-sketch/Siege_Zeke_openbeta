export const INVALID = 'SNAPSHOT_INVALID_INPUT';
export const UNSUPPORTED = 'SNAPSHOT_UNSUPPORTED_STATE';
export const FORMAT_ERROR = 'SNAPSHOT_UNSUPPORTED_FORMAT';
export const SCOPE = 'SNAPSHOT_SCOPE_MISMATCH';
export const VERSION = 'SNAPSHOT_VERSION_MISMATCH';
export const STATE = 'SNAPSHOT_INVALID_STATE';
export const NOT_READY = 'SNAPSHOT_REFERENCE_NOT_READY';
export const MISSING = Symbol('missing');
export class SnapshotError extends Error { constructor(code) { super(code); this.code = code; } }
export const reject = code => { throw new SnapshotError(code); };
export const nonempty = value => typeof value === 'string' && value.length > 0;

export function ordinary(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}

export function own(value, key, code, optional = false) {
  ordinary(value, code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return MISSING;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}

export function exact(value, keys, code) {
  ordinary(value, code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) reject(code);
  return Object.fromEntries(keys.map(key => [key, own(value, key, code)]));
}

export function dense(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const result = [];
  for (let i = 0; i < length.value; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    result.push(descriptor.value);
  }
  return result;
}

// `dropUndefined` is the save side's JSON.stringify reading of a field with no value: the field is left out.
// The load side keeps it strict, so a file that carries one is still refused.
export function copyJson(value, code, ancestors = new Set(), dropUndefined = false) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) reject(code);
    return value;
  }
  if (typeof value !== 'object') reject(code);
  if (ancestors.has(value)) reject(code);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return dense(value, code).map(item => copyJson(item, code, ancestors, dropUndefined));
    ordinary(value, code);
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') reject(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
      if (dropUndefined && descriptor.value === undefined) continue;
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, code, ancestors, dropUndefined), enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

export function seatIds(value, code) {
  const ids = dense(value, code);
  if (ids.length !== 2 || !ids.every(nonempty) || ids[0] === ids[1]) reject(code);
  return ids;
}

export function sameArray(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
