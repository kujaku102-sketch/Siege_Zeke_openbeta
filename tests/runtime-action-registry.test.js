import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionRegistryError, createActionRegistry, lookupActionHandler
} from '../src/game/runtime/action-registry.js';

const invalid = fn => assert.throws(fn,
  error => error instanceof ActionRegistryError && error.code === 'INVALID_ACTION_REGISTRY');

test('S03-REG-01: composes a frozen ordered registry and dispatches exact types', () => {
  const alpha = input => ({ type: 'alpha', input });
  const beta = input => ({ type: 'beta', input });
  const registry = createActionRegistry([
    { type: 'alpha', requiresReferenceState: false, prepare: alpha },
    { type: 'beta', requiresReferenceState: true, prepare: beta }
  ]);
  assert.deepEqual(registry.types, ['alpha', 'beta']);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.types), true);
  assert.equal(lookupActionHandler(registry, 'alpha').prepare, alpha);
  assert.equal(lookupActionHandler(registry, 'beta').requiresReferenceState, true);
  assert.equal(lookupActionHandler(registry, 'missing'), null);
});

test('S03-REG-02: rejects empty, duplicate and malformed entries', () => {
  const prepare = () => null;
  invalid(() => createActionRegistry([]));
  invalid(() => createActionRegistry([
    { type: 'same', requiresReferenceState: false, prepare },
    { type: 'same', requiresReferenceState: true, prepare }
  ]));
  for (const entry of [
    null,
    { type: '', requiresReferenceState: false, prepare },
    { type: 'a', requiresReferenceState: 0, prepare },
    { type: 'a', requiresReferenceState: false, prepare: 'prepare' },
    { type: 'a', requiresReferenceState: false, prepare, extra: true }
  ]) invalid(() => createActionRegistry([entry]));
});

test('S03-REG-03: entry accessors never execute and frozen entries are accepted', () => {
  let reads = 0;
  const accessor = { requiresReferenceState: false, prepare() {} };
  Object.defineProperty(accessor, 'type', { enumerable: true, get() { reads += 1; return 'a'; } });
  invalid(() => createActionRegistry([accessor]));
  assert.equal(reads, 0);

  const frozen = Object.freeze({ type: 'a', requiresReferenceState: false, prepare: () => 'ok' });
  const registry = createActionRegistry(Object.freeze([frozen]));
  assert.equal(lookupActionHandler(registry, 'a').prepare(), 'ok');
});

test('S03-REG-04: lookup rejects invalid registry and type inputs without fallback', () => {
  invalid(() => lookupActionHandler(null, 'a'));
  invalid(() => lookupActionHandler({}, 'a'));
  const registry = createActionRegistry([{ type: 'a', requiresReferenceState: false, prepare: () => null }]);
  invalid(() => lookupActionHandler(registry, ''));
  invalid(() => lookupActionHandler(registry, 1));
});
