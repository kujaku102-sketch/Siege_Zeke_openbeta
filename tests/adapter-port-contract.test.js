import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoundCommand, validatePortBinding, validateStatusView } from '../src/adapters/port-contract.js';

const binding = (overrides = {}) => ({
  contractVersion: 1, matchId: 'match-1', seatId: 'seat-a', seatIds: ['seat-a', 'seat-b'], sessionGeneration: 1,
  ...overrides
});
const status = (overrides = {}) => ({
  contractVersion: 1, matchId: 'match-1', revision: 0, viewerSeat: 'seat-a', activeSeat: 'seat-a',
  progress: 'ready', lockedOutcome: null, finished: false, requiredInput: null,
  seats: [{ seatId: 'seat-a', deckCount: 30, handCount: 5 }, { seatId: 'seat-b', deckCount: 30, handCount: 5 }],
  ...overrides
});

function frozen(value, seen = new Set()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (Object.hasOwn(descriptor, 'value')) frozen(descriptor.value, seen);
    }
    Object.freeze(value);
  }
  return value;
}

test('S05-PORT-01: exact binding is copied and keeps ordered seat scope', () => {
  const source = frozen(binding());
  const result = validatePortBinding(source);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value, source);
  assert.notEqual(result.value, source);
  assert.notEqual(result.value.seatIds, source.seatIds);
});

test('S05-PORT-02: malformed binding data fails closed', () => {
  const invalid = [null, [], binding({ contractVersion: 2 }), binding({ matchId: '' }), binding({ seatId: 'seat-c' }),
    binding({ seatIds: ['seat-a', 'seat-a'] }), binding({ sessionGeneration: 0 }), binding({ sessionGeneration: -0 }),
    { ...binding(), extra: true }, Object.assign(Object.create(null), binding())];
  for (const value of invalid) assert.deepEqual(validatePortBinding(value), { ok: false, error: { code: 'INVALID_PORT_BINDING' } });
});

test('S05-PORT-03: a bound intent cannot supply match or actor and reuses the runtime action schema', () => {
  const result = makeBoundCommand(binding({ seatId: 'seat-b' }), {
    commandId: 'command-1', expectedRevision: 4, action: { type: 'endTurn' }
  });
  assert.deepEqual(result, { ok: true, value: {
    contractVersion: 1, matchId: 'match-1', commandId: 'command-1', actorSeat: 'seat-b', expectedRevision: 4,
    action: { type: 'endTurn' }
  } });
  for (const intent of [
    { commandId: 'x', expectedRevision: 0, action: { type: 'endTurn' }, actorSeat: 'seat-b' },
    { commandId: 'x', expectedRevision: 0, action: { type: 'endTurn' }, matchId: 'other' },
    { commandId: '', expectedRevision: 0, action: { type: 'endTurn' } },
    { commandId: 'x', expectedRevision: -0, action: { type: 'endTurn' } }
  ]) assert.deepEqual(makeBoundCommand(binding(), intent), { ok: false, error: { code: 'INVALID_ADAPTER_INTENT' } });
});

test('S05-PORT-04: choice intents are bound without exposing continuation or engine names', () => {
  const result = makeBoundCommand(binding(), {
    commandId: 'choice-1', expectedRevision: 7,
    action: { type: 'answerChoice', choiceId: 'choice:7:selection', optionIds: ['option:2'], allocation: [] }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.actorSeat, 'seat-a');
  assert.deepEqual(result.value.action, {
    type: 'answerChoice', choiceId: 'choice:7:selection', optionIds: ['option:2'], allocation: []
  });
  assert.deepEqual(makeBoundCommand(binding(), {
    commandId: 'bad', expectedRevision: 0, action: { type: 'engineEscape', continuation: 'private' }
  }), { ok: false, error: { code: 'INVALID_ADAPTER_INTENT' } });
});

test('S05-PORT-05: status accepts every valid progress combination and returns detached count-only seats', () => {
  const cases = [
    status(),
    status({ progress: 'awaitingInput', requiredInput: { kind: 'waiting', seatId: 'seat-b' } }),
    status({ progress: 'resultLocked', lockedOutcome: { kind: 'win', winnerSeat: 'seat-a' }, requiredInput: { kind: 'waiting', seatId: 'seat-b' } }),
    status({ progress: 'finished', lockedOutcome: { kind: 'draw' }, finished: true })
  ];
  for (const source of cases) {
    const result = validateStatusView(binding(), frozen(source));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value, source);
    assert.notEqual(result.value.seats, source.seats);
  }
});

test('S05-PORT-06: status rejects scope drift, hidden payload additions, and contradictory progress', () => {
  assert.deepEqual(validateStatusView(binding(), status({ matchId: 'other' })), { ok: false, error: { code: 'PORT_SCOPE_MISMATCH' } });
  assert.deepEqual(validateStatusView(binding(), status({ viewerSeat: 'seat-b' })), { ok: false, error: { code: 'PORT_SCOPE_MISMATCH' } });
  const invalid = [
    status({ extra: true }), status({ revision: -0 }), status({ activeSeat: 'seat-c' }),
    status({ progress: 'ready', requiredInput: { kind: 'waiting', seatId: 'seat-a' } }),
    status({ progress: 'awaitingInput' }), status({ progress: 'finished', finished: true }),
    status({ progress: 'finished', lockedOutcome: { kind: 'win', winnerSeat: 'seat-a' } }),
    status({ seats: [{ seatId: 'seat-b', deckCount: 30, handCount: 5 }, { seatId: 'seat-a', deckCount: 30, handCount: 5 }] }),
    status({ seats: [{ seatId: 'seat-a', deckCount: 30, handCount: 5, cards: [] }, { seatId: 'seat-b', deckCount: 30, handCount: 5 }] })
  ];
  for (const value of invalid) assert.deepEqual(validateStatusView(binding(), value), { ok: false, error: { code: 'INVALID_STATUS_VIEW' } });
});

test('S05-PORT-07: getters are not invoked and reflection exceptions propagate', () => {
  let called = 0;
  const getter = Object.defineProperty(binding(), 'matchId', { enumerable: true, get() { called += 1; return 'match-1'; } });
  assert.deepEqual(validatePortBinding(getter), { ok: false, error: { code: 'INVALID_PORT_BINDING' } });
  assert.equal(called, 0);
  const reflection = new Error('reflection');
  assert.throws(() => validatePortBinding(new Proxy(binding(), { ownKeys() { throw reflection; } })), error => error === reflection);
});
