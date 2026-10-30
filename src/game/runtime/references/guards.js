export const INPUT = 'REF_INVALID_INPUT';
export const STATE = 'REF_INVALID_STATE';
export const FRAME = 'REF_INVALID_FRAME';
export const TRANSITION = 'REF_INVALID_TRANSITION';
export const INVALID_REF = 'REF_INVALID_REFERENCE';
export const nonempty = value => typeof value === 'string' && value.length > 0;
export const token = value => typeof value === 'string' && /^r:[0-9a-f]{32}$/.test(value);
export class ReferenceError extends Error { constructor(code) { super(code); this.code = code; } }
export const reject = code => { throw new ReferenceError(code); };
export function exact(input, names, code) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) reject(code);
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) reject(code);
  return Object.fromEntries(names.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return [name, descriptor.value];
  }));
}
export function dense(input, code) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(input);
  const length = Object.getOwnPropertyDescriptor(input, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}
export function identity(input, code) {
  const value = exact(input, ['matchId', 'instanceId'], code);
  if (!nonempty(value.matchId) || typeof value.instanceId !== 'string') reject(code);
  const serial = Number(value.instanceId.slice(2));
  if (!Number.isSafeInteger(serial) || serial <= 0 || value.instanceId !== `i:${serial}`) reject(code);
  return value;
}
export function seats(input, code) {
  const value = dense(input, code);
  if (value.length !== 2 || !value.every(nonempty) || value[0] === value[1]) reject(code);
  return value;
}
