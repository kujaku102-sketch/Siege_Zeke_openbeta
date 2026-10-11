export const SAFE_READ_MISSING = Symbol('safe-read-missing');

export class SafeReadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = code => { throw new SafeReadError(code); };

export function readOrdinary(value, code, ancestors = null) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  if (ancestors) {
    if (ancestors.has(value)) fail(code);
    ancestors.add(value);
  }
  return value;
}

export function readOwnData(object, key, code, fallback = SAFE_READ_MISSING) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return fallback;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

export function readDenseData(value, code, ancestors, mapper = item => item) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  if (ancestors.has(value)) fail(code);
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
      || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) fail(code);
    const result = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code);
      result.push(mapper(descriptor.value));
    }
    return result;
  } finally { ancestors.delete(value); }
}

export function readFiniteNumber(object, key, code, { fallback = 0, minimum = null } = {}) {
  const raw = readOwnData(object, key, code, SAFE_READ_MISSING);
  const value = raw === SAFE_READ_MISSING || raw === null || raw === undefined ? fallback : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
    || (minimum !== null && value < minimum)) fail(code);
  return value;
}
