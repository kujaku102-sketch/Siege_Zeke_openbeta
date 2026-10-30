import { SAFE_READ_MISSING, readDenseData, readFiniteNumber, readOrdinary, readOwnData } from '../safe-read.js';

export const MISSING = SAFE_READ_MISSING;
export const nonempty = value => typeof value === 'string' && value.length > 0;
export const safeRevision = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

export class CommandBridgeError extends Error { constructor(code) { super(code); this.code = code; } }
export const reject = code => { throw new CommandBridgeError(code); };

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
  const result = {};
  for (const key of keys) Object.defineProperty(result, key, {
    value: own(value, key, code), enumerable: true, writable: true, configurable: true
  });
  return result;
}

export function dense(value, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const result = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    result.push(descriptor.value);
  }
  return result;
}

export const selectedObject = readOrdinary;
export const selectedField = readOwnData;
export const selectedArray = readDenseData;
export const finiteNumberField = readFiniteNumber;

export function prepared(canonical, adapter) {
  return { ok: true, value: {
    kind: 'prepared', command: canonical.value.command,
    canonicalPayload: canonical.value.canonicalPayload, adapter
  } };
}
