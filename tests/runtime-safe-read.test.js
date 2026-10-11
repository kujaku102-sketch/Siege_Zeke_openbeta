import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_READ_MISSING, SafeReadError, readDenseData, readFiniteNumber, readOrdinary, readOwnData
} from '../src/game/runtime/safe-read.js';

const code = fn => assert.throws(fn, error => error instanceof SafeReadError && error.code === 'INVALID_FIXTURE');

test('S03-SAFE-01: reads frozen ordinary data and dense arrays without mutation', () => {
  const object = Object.freeze({ value: 3, items: Object.freeze(['a', 'b']) });
  const ancestors = new Set();
  assert.equal(readOrdinary(object, 'INVALID_FIXTURE', ancestors), object);
  assert.equal(readOwnData(object, 'value', 'INVALID_FIXTURE'), 3);
  assert.deepEqual(readDenseData(object.items, 'INVALID_FIXTURE', ancestors, item => item.toUpperCase()), ['A', 'B']);
  ancestors.delete(object);
  assert.deepEqual(object, { value: 3, items: ['a', 'b'] });
});

test('S03-SAFE-02: missing data uses only the explicit sentinel or fallback', () => {
  const object = {};
  assert.equal(readOwnData(object, 'missing', 'INVALID_FIXTURE'), SAFE_READ_MISSING);
  assert.equal(readOwnData(object, 'missing', 'INVALID_FIXTURE', null), null);
  assert.equal(readFiniteNumber(object, 'missing', 'INVALID_FIXTURE', { fallback: 7, minimum: 0 }), 7);
});

test('S03-SAFE-03: accessors, exotic objects and cyclic ancestry are rejected without getter execution', () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { reads += 1; return 1; } });
  code(() => readOwnData(accessor, 'value', 'INVALID_FIXTURE'));
  assert.equal(reads, 0);
  code(() => readOrdinary([], 'INVALID_FIXTURE'));
  code(() => readOrdinary(Object.create(null), 'INVALID_FIXTURE'));
  const ordinary = {};
  code(() => readOrdinary(ordinary, 'INVALID_FIXTURE', new Set([ordinary])));
});

test('S03-SAFE-04: sparse, accessor and extra-key arrays are rejected', () => {
  const sparse = new Array(1);
  code(() => readDenseData(sparse, 'INVALID_FIXTURE', new Set()));
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, configurable: true, get() { throw new Error('must not run'); } });
  accessor.length = 1;
  code(() => readDenseData(accessor, 'INVALID_FIXTURE', new Set()));
  const extra = ['a'];
  extra.extra = true;
  code(() => readDenseData(extra, 'INVALID_FIXTURE', new Set()));
});

test('S03-SAFE-05: finite numbers stay primitive and respect minimum without coercion', () => {
  assert.equal(readFiniteNumber({ value: 0 }, 'value', 'INVALID_FIXTURE', { minimum: 0 }), 0);
  for (const value of [-1, -0, NaN, Infinity, '1', true]) {
    code(() => readFiniteNumber({ value }, 'value', 'INVALID_FIXTURE', { minimum: 0 }));
  }
});
