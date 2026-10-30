export const INPUT = 'RUNTIME_INVALID_QUERY_INPUT';
export const STATE = 'RUNTIME_INVALID_QUERY_STATE';
export const MISSING = Symbol('missing');
export const ZONES = ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban'];
export const nonempty = value => typeof value === 'string' && value.length > 0;
export class QueryError extends Error { constructor(code) { super(code); this.code = code; } }
export const reject = code => { throw new QueryError(code); };
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
export function exact(object, keys, code = INPUT) {
  ordinary(object, code);
  const names = Reflect.ownKeys(object);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) reject(code);
  return Object.fromEntries(keys.map(key => [key, own(object, key, false, code)]));
}
export function dense(array, code = STATE) {
  if (array === null || typeof array !== 'object' || Object.getPrototypeOf(array) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(array);
  const length = Object.getOwnPropertyDescriptor(array, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}
export function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(STATE);
  return value;
}
export function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (positive ? 1 : 0)) reject(STATE);
  return value;
}
export function booleanField(object, key) {
  const value = own(object, key, true);
  if (value === MISSING) return false;
  if (typeof value !== 'boolean') reject(STATE);
  return value;
}
export function strings(value, code = STATE) {
  const result = dense(value, code);
  if (!result.every(item => typeof item === 'string')) reject(code);
  return result;
}
export function ref(input) {
  const result = exact(input, ['matchId', 'instanceId']);
  if (!nonempty(result.matchId) || typeof result.instanceId !== 'string') reject(INPUT);
  const serial = Number(result.instanceId.slice(2));
  if (!Number.isSafeInteger(serial) || serial <= 0 || result.instanceId !== `i:${serial}`) reject(INPUT);
  return result;
}
export function playerId(seats, seat) {
  const position = seats.indexOf(seat);
  if (position < 0) reject('SEAT_MISMATCH');
  return position === 0 ? 'player' : 'ai';
}
