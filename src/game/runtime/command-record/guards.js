export const REFERENCE_TOKEN = /^r:[0-9a-f]{32}$/;
export const MISSING = Symbol('missing');

export class CommandRecordError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export const reject = code => { throw new CommandRecordError(code); };
export const nonempty = value => typeof value === 'string' && value.length > 0;
export const revision = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

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

export function dense(value, code, ancestors = new Set()) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const rows = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    rows.push(copyData(descriptor.value, code, ancestors));
  }
  return rows;
}

export function copyData(value, code, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) reject(code);
    return value;
  }
  if (typeof value !== 'object') reject(code);
  if (ancestors.has(value)) reject(code);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return dense(value, code, ancestors);
    ordinary(value, code);
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') reject(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
      Object.defineProperty(result, key, {
        value: copyData(descriptor.value, code, ancestors), enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function seatList(value, code) {
  const seats = dense(value, code);
  if (seats.length !== 2 || !seats.every(nonempty) || seats[0] === seats[1]) reject(code);
  return seats;
}
