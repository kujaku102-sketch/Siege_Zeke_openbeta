const SCHEMA_VERSION = 1;
const ALGORITHM = 'mulberry32-v1';
const INCREMENT = 0x6D2B79F5;
const UINT32_SIZE = 4294967296;
const STATE_KEYS = ['schemaVersion', 'algorithm', 'seed', 'cursor', 'draws'];
const success = value => ({ ok: true, value });
const failure = code => ({ ok: false, error: { code } });
const nonnegative = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const uint32 = value => nonnegative(value) && value < UINT32_SIZE;

function fields(input, names) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length) return null;
  const result = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !names.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function validatedState(input) {
  const state = fields(input, STATE_KEYS);
  if (!state || !nonnegative(state.schemaVersion) || typeof state.algorithm !== 'string') return failure('RNG_INVALID_INPUT');
  if (state.schemaVersion !== SCHEMA_VERSION || state.algorithm !== ALGORITHM) return failure('RNG_UNSUPPORTED_FORMAT');
  if (!uint32(state.seed) || !uint32(state.cursor) || !nonnegative(state.draws)) return failure('RNG_INVALID_INPUT');
  const expected = (BigInt(state.seed) + BigInt(state.draws) * 0x6D2B79F5n) % 0x100000000n;
  if (BigInt(state.cursor) !== expected) return failure('RNG_INVALID_INPUT');
  return success({ schemaVersion: state.schemaVersion, algorithm: state.algorithm, seed: state.seed, cursor: state.cursor, draws: state.draws });
}

export function createRngState(input) {
  const args = fields(input, ['seed']);
  if (!args || !uint32(args.seed)) return failure('RNG_INVALID_INPUT');
  return success({ schemaVersion: SCHEMA_VERSION, algorithm: ALGORITHM, seed: args.seed, cursor: args.seed, draws: 0 });
}

export function nextRng(input) {
  const restored = validatedState(input);
  if (!restored.ok) return restored;
  const state = restored.value;
  if (state.draws === Number.MAX_SAFE_INTEGER) return failure('RNG_EXHAUSTED');
  const cursor = (state.cursor + INCREMENT) >>> 0;
  let t = Math.imul(cursor ^ (cursor >>> 15), cursor | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = (t ^ (t >>> 14)) >>> 0;
  return success({ state: { ...state, cursor, draws: state.draws + 1 }, value: u / UINT32_SIZE });
}

export function restoreRngState(input) {
  return validatedState(input);
}
