

export const INPUT = 'PROJECTION_INVALID_CONTEXT';
export const STATE = 'PROJECTION_INVALID_STATE';
export const SCOPE = 'PROJECTION_SCOPE_MISMATCH';
export const NOT_READY = 'PROJECTION_REFERENCE_NOT_READY';
export const MISSING = Symbol('missing');
export const TOKEN = /^r:[0-9a-f]{32}$/;
const INSTANCE = /^i:[1-9][0-9]*$/;
export const ZONES = ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban'];
export const PUBLIC_KEYWORDS = [
  'QA', 'SECURITY', 'CONTACT', 'HACKING', 'DISCONNECT', 'ENCRYPTION',
  'RESIDENT', 'DECOY', 'PROTECT', 'LAYERED', 'LOGIN', 'LOGOUT'
];
export class ProjectionError extends Error { constructor(code) { super(code); this.code = code; } }
export const reject = code => { throw new ProjectionError(code); };

export function ordinary(value, code = STATE) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}

export function own(object, key, optional = false, code = STATE) {
  ordinary(object, code);
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor && optional) return MISSING;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}

export function exact(object, names, code = STATE) {
  ordinary(object, code);
  const keys = Reflect.ownKeys(object);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) reject(code);
  return Object.fromEntries(names.map(name => [name, own(object, name, false, code)]));
}

export function dense(array, code = STATE) {
  if (array === null || typeof array !== 'object' || Object.getPrototypeOf(array) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(array);
  const length = Object.getOwnPropertyDescriptor(array, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}

export function nonempty(value) { return typeof value === 'string' && value.length > 0; }
export function finite(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) reject(STATE);
  return value;
}
export function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(STATE);
  return value;
}
export function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (positive ? 1 : 0)) reject(STATE);
  return value;
}
export function text(value) {
  if (typeof value !== 'string') reject(STATE);
  return value;
}
export function token(value) { return typeof value === 'string' && TOKEN.test(value); }
export function serial(value) {
  if (typeof value !== 'string' || !INSTANCE.test(value)) reject(STATE);
  const number = Number(value.slice(2));
  if (!Number.isSafeInteger(number) || number <= 0 || value !== `i:${number}`) reject(STATE);
  return number;
}

export function seatIds(value, code = STATE) {
  const result = dense(value, code);
  if (result.length !== 2 || !result.every(nonempty) || result[0] === result[1]) reject(code);
  return result;
}
