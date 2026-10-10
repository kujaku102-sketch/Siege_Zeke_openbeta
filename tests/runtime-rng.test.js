import test from 'node:test';
import assert from 'node:assert/strict';
import { createRngState, nextRng, restoreRngState } from '../src/game/runtime/rng.js';

const stateKeys = ['schemaVersion', 'algorithm', 'seed', 'cursor', 'draws'];
const state = (seed = 0, cursor = seed, draws = 0) => ({ schemaVersion: 1, algorithm: 'mulberry32-v1', seed, cursor, draws });
const stateApis = [nextRng, restoreRngState];

function snapshot(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return { shared: seen.get(value) };
  seen.set(value, seen.size);
  return { prototype: Object.getPrototypeOf(value), descriptors: Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return [key, Object.hasOwn(descriptor, 'value') ? { ...descriptor, value: snapshot(descriptor.value, seen) } : descriptor];
  }) };
}

function invoke(api, input) {
  const before = snapshot(input);
  const result = api(input);
  assert.deepEqual(snapshot(input), before);
  assert.deepEqual(Object.keys(result), result.ok ? ['ok', 'value'] : ['ok', 'error']);
  if (!result.ok) assert.deepEqual(Object.keys(result.error), ['code']);
  return result;
}

function value(api, input) {
  const result = invoke(api, input);
  assert.equal(result.ok, true);
  return result.value;
}

function rejects(code, api, input) {
  assert.deepEqual(invoke(api, input), { ok: false, error: { code } });
}

test('S02-RNG-01: initial state and exact envelopes', () => {
  for (const seed of [0, 1, 2147483648, 4294967295]) {
    const initial = value(createRngState, { seed });
    assert.deepEqual(initial, state(seed));
    assert.deepEqual(Object.keys(initial), stateKeys);
    const next = value(nextRng, initial);
    assert.deepEqual(Object.keys(next), ['state', 'value']);
    assert.deepEqual(Object.keys(next.state), stateKeys);
    assert.equal(next.state.seed, seed);
    assert.equal(next.state.draws, 1);
    assert.equal(typeof next.value, 'number');
    assert.ok(next.value >= 0 && next.value < 1);
    assert.deepEqual(value(restoreRngState, next.state), next.state);
  }
});

test('S02-RNG-02: independent literal seed-zero vector', () => {
  const expected = [1144304738, 1416247, 958946056, 627933444, 2007157716, 2340967985];
  const cursors = [1831565813, 3663131626, 1199730143, 3031295956, 567894473, 2399460286];
  let live = value(createRngState, { seed: 0 });
  for (let i = 0; i < expected.length; i += 1) {
    const next = value(nextRng, live);
    assert.equal(next.value, expected[i] / 4294967296);
    assert.deepEqual(next.state, state(0, cursors[i], i + 1));
    live = next.state;
  }
});

test('S02-RNG-03: independent literal maximum-seed vector', () => {
  const expected = [3850105811, 813802916, 3073704848, 4054706436, 3630262831, 2315588663];
  let live = value(createRngState, { seed: 4294967295 });
  for (let i = 0; i < expected.length; i += 1) {
    const next = value(nextRng, live);
    assert.equal(next.value, expected[i] / 4294967296);
    assert.equal(next.state.seed, 4294967295);
    assert.equal(next.state.draws, i + 1);
    live = next.state;
  }
});

test('S02-RNG-04: repeat and JSON-copy continuation', () => {
  let left = value(createRngState, { seed: 123456789 });
  let right = value(createRngState, { seed: 123456789 });
  for (let i = 0; i < 32; i += 1) {
    const a = value(nextRng, left);
    const b = value(nextRng, right);
    assert.deepEqual(a, b);
    assert.equal(a.state.draws, left.draws + 1);
    left = a.state;
    right = b.state;
  }
  const encoded = JSON.stringify(left);
  let copied = value(restoreRngState, JSON.parse(encoded));
  assert.equal(JSON.stringify(copied), encoded);
  for (let i = 0; i < 32; i += 1) {
    const a = value(nextRng, left);
    const b = value(nextRng, copied);
    assert.deepEqual(a, b);
    assert.equal(a.state.draws, left.draws + 1);
    assert.ok(a.value >= 0 && a.value < 1);
    left = a.state;
    copied = b.state;
  }
});

test('S02-RNG-05: final safe draw and exhausted-state restoration', () => {
  const penultimate = state(0, 631835670, 9007199254740990);
  assert.deepEqual(value(restoreRngState, penultimate), penultimate);
  const final = value(nextRng, penultimate);
  assert.deepEqual(final, { state: state(0, 2463401483, 9007199254740991), value: 2653427450 / 4294967296 });
  assert.deepEqual(value(restoreRngState, final.state), final.state);
  rejects('RNG_EXHAUSTED', nextRng, final.state);
  rejects('RNG_EXHAUSTED', nextRng, Object.freeze(final.state));
  for (const api of stateApis) rejects('RNG_INVALID_INPUT', api, { ...final.state, cursor: 2463401482 });
});

test('S02-RNG-06: cursor, seed and draw consistency', () => {
  const initial = state(5);
  const advanced = value(nextRng, initial).state;
  const forged = [state(5, 6), { ...advanced, cursor: advanced.cursor + 1 }, { ...advanced, seed: 6 }, { ...advanced, draws: 0 }, { ...advanced, draws: 2 }];
  for (const api of stateApis) {
    assert.deepEqual(value(api === nextRng ? restoreRngState : api, initial), initial);
    for (const input of forged) rejects('RNG_INVALID_INPUT', api, input);
  }
});

test('S02-RNG-07: primitive, array and prototype rejection', () => {
  const invalid = [null, undefined, 0, -0, 1, '0', true, 0n, Symbol('input'), () => 0, [], new Date(), new Map(), new Number(0)];
  for (const api of [createRngState, ...stateApis]) {
    for (const input of invalid) rejects('RNG_INVALID_INPUT', api, input);
    const data = api === createRngState ? { seed: 0 } : state();
    for (const prototype of [null, {}, { seed: 0 }]) rejects('RNG_INVALID_INPUT', api, Object.assign(Object.create(prototype), data));
    class Custom {}
    rejects('RNG_INVALID_INPUT', api, Object.assign(new Custom(), data));
  }
});

test('S02-RNG-08: exact own enumerable fields', () => {
  for (const api of [createRngState, ...stateApis]) {
    const data = api === createRngState ? { seed: 0 } : state();
    const names = Object.keys(data);
    rejects('RNG_INVALID_INPUT', api, {});
    rejects('RNG_INVALID_INPUT', api, { ...data, extra: 1 });
    rejects('RNG_INVALID_INPUT', api, { ...data, [Symbol('extra')]: 1 });
    rejects('RNG_INVALID_INPUT', api, Object.defineProperty({ ...data }, 'extra', { value: 1 }));
    for (const name of names) {
      const missing = { ...data };
      delete missing[name];
      rejects('RNG_INVALID_INPUT', api, missing);
      rejects('RNG_INVALID_INPUT', api, Object.defineProperty({ ...data }, name, { enumerable: false }));
      const substituted = { ...missing, [Symbol(name)]: data[name] };
      rejects('RNG_INVALID_INPUT', api, substituted);
    }
  }
});

test('S02-RNG-09: accessors rejected without executing getters or setters', () => {
  let called = 0;
  for (const api of [createRngState, ...stateApis]) {
    const data = api === createRngState ? { seed: 0 } : state();
    for (const name of Object.keys(data)) {
      const accessor = Object.defineProperty({ ...data }, name, { enumerable: true, get() { called += 1; throw new Error('getter executed'); } });
      rejects('RNG_INVALID_INPUT', api, accessor);
      const setter = Object.defineProperty({ ...data }, name, { enumerable: true, set() { called += 1; } });
      rejects('RNG_INVALID_INPUT', api, setter);
    }
  }
  assert.equal(called, 0);
});

test('S02-RNG-10: strict uint32 and safe draw numbers', () => {
  const invalidNumbers = [-0, -1, 0.5, NaN, Infinity, -Infinity, '0', true, null, undefined, 0n, Symbol('number'), {}, new Number(0), Number.MAX_SAFE_INTEGER + 1];
  for (const seed of [...invalidNumbers, 4294967296]) rejects('RNG_INVALID_INPUT', createRngState, { seed });
  for (const api of stateApis) {
    for (const name of ['seed', 'cursor', 'draws']) {
      for (const invalid of invalidNumbers) rejects('RNG_INVALID_INPUT', api, { ...state(), [name]: invalid });
    }
    for (const name of ['seed', 'cursor']) rejects('RNG_INVALID_INPUT', api, { ...state(), [name]: 4294967296 });
    assert.deepEqual(value(restoreRngState, state(0, 0, 4294967296)), state(0, 0, 4294967296));
  }
});

test('S02-RNG-11: identifier types precede unsupported formats', () => {
  const invalidVersions = [-0, -1, 0.5, NaN, Infinity, -Infinity, '1', true, null, undefined, 1n, Symbol('version'), {}, new Number(1), Number.MAX_SAFE_INTEGER + 1];
  const invalidAlgorithms = [0, true, null, undefined, 0n, Symbol('algorithm'), {}, new String('mulberry32-v1')];
  for (const api of stateApis) {
    for (const schemaVersion of invalidVersions) rejects('RNG_INVALID_INPUT', api, { ...state(), schemaVersion, algorithm: 'unknown' });
    for (const algorithm of invalidAlgorithms) rejects('RNG_INVALID_INPUT', api, { ...state(), schemaVersion: 2, algorithm });
  }
});

test('S02-RNG-12: unsupported identifiers precede numeric and exhaustion checks', () => {
  const formats = [{ schemaVersion: 0 }, { schemaVersion: 2 }, { schemaVersion: Number.MAX_SAFE_INTEGER }, { algorithm: '' }, { algorithm: 'mulberry32-v2' }, { schemaVersion: 2, algorithm: 'unknown' }];
  const numeric = [{}, { seed: -0 }, { cursor: 4294967296 }, { draws: '0' }, { cursor: 1 }, { draws: Number.MAX_SAFE_INTEGER }];
  for (const api of stateApis) {
    for (const format of formats) {
      for (const fields of numeric) rejects('RNG_UNSUPPORTED_FORMAT', api, { ...state(), ...fields, ...format });
      rejects('RNG_INVALID_INPUT', api, { ...state(), ...format, extra: 0 });
      const malformed = Object.defineProperty({ ...state(), ...format }, 'seed', { get() { throw new Error('getter executed'); }, enumerable: true });
      rejects('RNG_INVALID_INPUT', api, malformed);
    }
  }
});

test('S02-RNG-13: field order and frozen data descriptors accepted', () => {
  const ordered = { draws: 0, cursor: 42, seed: 42, algorithm: 'mulberry32-v1', schemaVersion: 1 };
  const locked = {};
  for (const [name, field] of Object.entries(ordered)) Object.defineProperty(locked, name, { value: field, enumerable: true, writable: false, configurable: false });
  assert.deepEqual(value(createRngState, Object.freeze({ seed: 42 })), state(42));
  assert.deepEqual(value(restoreRngState, Object.freeze(ordered)), state(42));
  assert.deepEqual(value(restoreRngState, locked), state(42));
  assert.deepEqual(value(nextRng, locked), value(nextRng, state(42)));
});

test('S02-RNG-14: input immutability and independent result objects', () => {
  const args = Object.freeze({ seed: 42 });
  const a = value(createRngState, args);
  const b = value(createRngState, args);
  assert.notEqual(a, b);
  const frozen = Object.freeze(a);
  const restoredA = value(restoreRngState, frozen);
  const restoredB = value(restoreRngState, frozen);
  assert.notEqual(restoredA, frozen);
  assert.notEqual(restoredA, restoredB);
  restoredA.seed = 99;
  assert.deepEqual(restoredB, state(42));
  const left = value(nextRng, frozen);
  const right = value(nextRng, frozen);
  assert.deepEqual(left, right);
  assert.notEqual(left, right);
  assert.notEqual(left.state, right.state);
  assert.notEqual(left.state, frozen);
  const originalRight = { ...right.state };
  left.state.cursor = 0;
  left.state.draws = 100;
  assert.deepEqual(right.state, originalRight);
  assert.deepEqual(frozen, state(42));
  b.seed = 99;
  assert.deepEqual(value(createRngState, args), state(42));
  const errorA = invoke(nextRng, null);
  const errorB = invoke(nextRng, null);
  assert.notEqual(errorA, errorB);
  assert.notEqual(errorA.error, errorB.error);
});

test('S02-RNG-15: reflection exceptions propagate', () => {
  for (const api of [createRngState, ...stateApis]) {
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const reflectionFailure = new Error(`reflection ${trap}`);
      const data = api === createRngState ? { seed: 0 } : state();
      const proxy = new Proxy(data, { [trap]() { throw reflectionFailure; } });
      assert.throws(() => api(proxy), error => error === reflectionFailure);
    }
    const revoked = Proxy.revocable(api === createRngState ? { seed: 0 } : state(), {});
    revoked.revoke();
    assert.throws(() => api(revoked.proxy), TypeError);
  }
});
