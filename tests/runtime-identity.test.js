import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityState, allocateInstanceId, retireInstanceId, buildIdentityIndex, findIdentityEntry } from '../src/game/runtime/identity.js';

function snapshot(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return { shared: seen.get(value) };
  seen.set(value, seen.size);
  return { prototype: Object.getPrototypeOf(value), descriptors: Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return [key, Object.hasOwn(descriptor, 'value') ? { ...descriptor, value: snapshot(descriptor.value, seen) } : descriptor];
  }) };
}

function invoke(api, ...args) {
  const before = args.map(arg => snapshot(arg));
  const result = api(...args);
  assert.deepEqual(args.map(arg => snapshot(arg)), before);
  assert.deepEqual(Object.keys(result), result.ok ? ['ok', 'value'] : ['ok', 'error']);
  if (!result.ok) assert.deepEqual(Object.keys(result.error), ['code']);
  return result;
}

function value(api, ...args) {
  const result = invoke(api, ...args);
  assert.equal(result.ok, true);
  return result.value;
}

function rejects(code, api, ...args) {
  assert.deepEqual(invoke(api, ...args), { ok: false, error: { code } });
}

const ref = (number, matchId = 'match-a') => ({ matchId, instanceId: `i:${number}` });
const state = (nextSerial = 1, retiredIds = [], matchId = 'match-a', seatIds = ['seat-a', 'seat-b']) => ({ matchId, seatIds, nextSerial, retiredIds });
const zone = (zoneName = 'hand', seatId = 'seat-a') => ({ kind: 'zone', seatId, zone: zoneName });
const board = (position = 1, seatId = 'seat-a', area = 'front') => ({ kind: 'board', seatId, zone: area, position });
const mount = (host, order = 1, role = 'mount') => ({ kind: 'mounted', host, order, role });
const flight = storageKey => ({ kind: 'inflight', storageKey });
const record = (number, location = zone(), ownerSeat = 'seat-a', controllerSeat = 'seat-a') => ({ identity: ref(number), ownerSeat, controllerSeat, location });
const index = entries => ({ matchId: 'match-a', entries });

function frozen(value) {
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (Object.hasOwn(descriptor, 'value')) frozen(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

test('S01-01', () => {
  const args = { matchId: 'match-a', seatIds: ['seat-a', 'seat-b'] };
  const initial = value(createIdentityState, args);
  assert.deepEqual(initial, state());
  assert.deepEqual(Object.keys(initial), ['matchId', 'seatIds', 'nextSerial', 'retiredIds']);
  const first = value(allocateInstanceId, initial);
  const second = value(allocateInstanceId, first.state);
  assert.deepEqual(first.identity, ref(1));
  assert.deepEqual(second.identity, ref(2));
  assert.equal(second.state.nextSerial, 3);
  assert.deepEqual(initial, state());
  args.seatIds[0] = 'changed';
  assert.equal(initial.seatIds[0], 'seat-a');
  assert.deepEqual(Object.keys(first.identity), ['matchId', 'instanceId']);
});

test('S01-02', () => {
  const first = value(allocateInstanceId, state());
  const rematch = value(allocateInstanceId, state(1, [], 'match-b'));
  assert.equal(first.identity.instanceId, rematch.identity.instanceId);
  assert.notEqual(first.identity.matchId, rematch.identity.matchId);
  rejects('MATCH_MISMATCH', retireInstanceId, first.state, rematch.identity);
  rejects('MATCH_MISMATCH', buildIdentityIndex, first.state, [{ ...record(1), identity: rematch.identity }]);
  rejects('MATCH_MISMATCH', buildIdentityIndex, state(3), [record(1), record(2, mount(ref(1, 'match-b')))]);
  rejects('MATCH_MISMATCH', findIdentityEntry, index([record(1)]), rematch.identity);
});

test('S01-03', () => {
  let live = value(retireInstanceId, state(5), ref(3));
  live = value(retireInstanceId, live, ref(1));
  assert.deepEqual(live.retiredIds, ['i:1', 'i:3']);
  const again = value(retireInstanceId, live, ref(3));
  assert.deepEqual(again, live);
  assert.notEqual(again, live);
  assert.notEqual(again.retiredIds, live.retiredIds);
  const next = value(allocateInstanceId, live);
  assert.deepEqual(next.identity, ref(5));
  rejects('UNKNOWN_INSTANCE', retireInstanceId, live, ref(5));
  for (const name of ['trash', 'ban', 'deck']) assert.equal(value(buildIdentityIndex, state(2), [record(1, zone(name))]).entries.length, 1);
});

test('S01-04', () => {
  const invalidArgs = [null, {}, { matchId: '', seatIds: ['a', 'b'] }, { matchId: 'm', seatIds: ['a', 'a'] }, { matchId: 'm', seatIds: ['a'] }, { matchId: 'm', seatIds: ['a', 'b'], extra: 1 }, { matchId: 1, seatIds: ['a', 'b'] }];
  for (const args of invalidArgs) rejects('INVALID_IDENTITY_STATE', createIdentityState, args);
  for (const nextSerial of [0, -1, 1.5, '2', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) rejects('INVALID_IDENTITY_STATE', allocateInstanceId, { ...state(), nextSerial });
  for (const retiredIds of [['i:2', 'i:1'], ['i:1', 'i:1'], ['i:3'], ['i:01'], [1]]) rejects('INVALID_IDENTITY_STATE', allocateInstanceId, state(3, retiredIds));
  rejects('INVALID_IDENTITY_STATE', allocateInstanceId, { ...state(), schemaVersion: 1 });
  for (const id of ['i:0', 'i:-1', 'i:+1', 'i:01', 'i:1.0', 'i:1e0', 'i: 1', 'i:1 ', 'i:1\n', 'i:9007199254740992', 1, true, undefined, 1n, Symbol('id')]) rejects('INVALID_IDENTITY_REF', retireInstanceId, state(2), { matchId: 'match-a', instanceId: id });
  rejects('INVALID_IDENTITY_REF', retireInstanceId, state(2), { ...ref(1), extra: 1 });
  const max = Number.MAX_SAFE_INTEGER;
  const last = value(allocateInstanceId, state(max - 1));
  assert.equal(last.identity.instanceId, `i:${max - 1}`);
  rejects('IDENTITY_EXHAUSTED', allocateInstanceId, last.state);
  rejects('UNKNOWN_INSTANCE', retireInstanceId, last.state, ref(max));
  rejects('INVALID_LOCATION', buildIdentityIndex, last.state, [record(1)]);
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [record(1, board(max + 1))]);
  assert.equal(value(createIdentityState, { matchId: ' ', seatIds: [' a', 'a'] }).matchId, ' ');
});

test('S01-05', () => {
  const live = state(5, ['i:2'], 'match-a', ['seat-b', 'seat-a']);
  const left = value(allocateInstanceId, live);
  const right = value(allocateInstanceId, live);
  assert.deepEqual(left, right);
  assert.deepEqual(left.state.seatIds, ['seat-b', 'seat-a']);
  assert.deepEqual(left.state.retiredIds, ['i:2']);
  left.state.seatIds.reverse();
  left.state.retiredIds.push('i:3');
  assert.deepEqual(right.state.seatIds, ['seat-b', 'seat-a']);
  assert.deepEqual(right.state.retiredIds, ['i:2']);
  assert.deepEqual(live, state(5, ['i:2'], 'match-a', ['seat-b', 'seat-a']));
  const retired = value(retireInstanceId, right.state, right.identity);
  const built = value(buildIdentityIndex, retired, [record(1), record(3), record(4)]);
  assert.deepEqual(value(findIdentityEntry, built, ref(3)), record(3));
});

test('S01-06', () => {
  const rows = [record(1, zone('deck')), record(2, zone('registry', 'seat-b'), 'seat-a', 'seat-b'), record(3, board(1)), record(4, board(3)), record(5, board(100, 'seat-b', 'back'), 'seat-b', 'seat-b'), record(6, zone('hand'))];
  const built = value(buildIdentityIndex, state(7), rows);
  assert.deepEqual(built.entries, rows);
  rejects('SEAT_MISMATCH', buildIdentityIndex, state(2), [record(1, zone(), 'unknown')]);
  rejects('SEAT_MISMATCH', buildIdentityIndex, state(2), [record(1, zone(), 'seat-a', 'unknown')]);
  rejects('SEAT_MISMATCH', buildIdentityIndex, state(2), [record(1, zone('hand', 'unknown'))]);
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [record(1, board(1, 'seat-b'))]);
  for (const location of [zone('BAN'), board(0), { ...board(), extra: 1 }, { kind: 'zone', seatId: 'seat-a', zone: 'front' }]) rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [record(1, location)]);
});

test('S01-07', () => {
  const rows = [record(1, zone('trash')), record(2, mount(ref(1), 3, 'layered'), 'seat-b'), record(3, mount(ref(2), 7, 'mount'), 'seat-b')];
  assert.deepEqual(value(buildIdentityIndex, state(4), rows).entries, rows);
  rejects('INVALID_LOCATION', buildIdentityIndex, state(3), [record(1), record(2, mount(ref(1)), 'seat-b', 'seat-b')]);
  for (const location of [mount(ref(1), 0), mount(ref(1), 1.5), mount(ref(1), 1, 'Code'), { ...mount(ref(1)), category: 'Ob' }]) rejects('INVALID_LOCATION', buildIdentityIndex, state(3), [record(1), record(2, location)]);
  rejects('INVALID_IDENTITY_REF', buildIdentityIndex, state(3), [record(1), record(2, mount({ ...ref(1), uid: 'old' }))]);
  const chain = [record(1, flight('root'))];
  for (let i = 2; i <= 12000; i += 1) chain.push(record(i, mount(ref(i - 1))));
  assert.equal(value(buildIdentityIndex, state(12001), chain).entries.length, 12000);
});

test('S01-08', () => {
  const before = value(buildIdentityIndex, state(3), [record(1, zone('ban')), record(2, flight('physical:one'))]);
  const after = value(buildIdentityIndex, state(3), [record(1, flight('physical:two')), record(2, zone('trash'))]);
  assert.deepEqual(before.entries.map(row => row.identity), after.entries.map(row => row.identity));
  assert.deepEqual(value(findIdentityEntry, after, ref(1)).location, flight('physical:two'));
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [record(1, { kind: 'history', storageKey: 'past' })]);
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [record(1, flight(''))]);
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [{ ...record(1), uid: 'legacy' }]);
});

test('S01-09', () => {
  rejects('DUPLICATE_INSTANCE', buildIdentityIndex, state(2), [record(1), record(1)]);
  rejects('UNKNOWN_INSTANCE', buildIdentityIndex, state(2), [record(2)]);
  rejects('RETIRED_INSTANCE', buildIdentityIndex, state(2, ['i:1']), [record(1)]);
  rejects('INVALID_LOCATION', buildIdentityIndex, state(3), [record(1)]);
  rejects('UNKNOWN_INSTANCE', buildIdentityIndex, state(2), [record(1), record(2)]);
  rejects('RETIRED_INSTANCE', buildIdentityIndex, state(3, ['i:2']), [record(1), record(2)]);
  assert.deepEqual(value(buildIdentityIndex, state(), []), index([]));
  assert.equal(value(findIdentityEntry, index([]), ref(1)), null);
});

test('S01-10', () => {
  rejects('DUPLICATE_LOCATION', buildIdentityIndex, state(3), [record(1, board()), record(2, board())]);
  rejects('DUPLICATE_LOCATION', buildIdentityIndex, state(4), [record(1), record(2, mount(ref(1), 1, 'mount')), record(3, mount(ref(1), 1, 'layered'))]);
  rejects('DUPLICATE_LOCATION', buildIdentityIndex, state(3), [record(1, flight('same')), record(2, flight('same'))]);
  rejects('MISSING_HOST', buildIdentityIndex, state(3), [record(1), record(2, mount(ref(3)))]);
  rejects('MOUNT_CYCLE', buildIdentityIndex, state(2), [record(1, mount(ref(1)))]);
  rejects('MOUNT_CYCLE', buildIdentityIndex, state(4), [record(1, mount(ref(2))), record(2, mount(ref(3))), record(3, mount(ref(1)))]);
  const seatsWithSeparators = ['a|b', 'a'];
  const rows = [record(1, board(1, 'a|b'), 'a|b', 'a|b'), record(2, board(1, 'a'), 'a', 'a')];
  assert.equal(value(buildIdentityIndex, state(3, [], 'match-a', seatsWithSeparators), rows).entries.length, 2);
});

test('S01-11', () => {
  let called = 0;
  const accessor = { seatIds: ['seat-a', 'seat-b'] };
  Object.defineProperty(accessor, 'matchId', { enumerable: true, get() { called += 1; return 'match-a'; } });
  rejects('INVALID_IDENTITY_STATE', createIdentityState, accessor);
  const refAccessor = { instanceId: 'i:1' };
  Object.defineProperty(refAccessor, 'matchId', { enumerable: true, get() { called += 1; return 'match-a'; } });
  rejects('INVALID_IDENTITY_REF', retireInstanceId, state(2), refAccessor);
  const locationAccessor = { seatId: 'seat-a', zone: 'hand' };
  Object.defineProperty(locationAccessor, 'kind', { enumerable: true, get() { called += 1; return 'zone'; } });
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [record(1, locationAccessor)]);
  assert.equal(called, 0);
  for (const malformed of [Object.assign(Object.create(null), state()), Object.assign(Object.create({}), state()), new Date(), new Map(), { ...state(), [Symbol('extra')]: 1 }, Object.defineProperty(state(), 'extra', { value: 1 })]) rejects('INVALID_IDENTITY_STATE', allocateInstanceId, malformed);
  for (const rows of [[,], Object.assign([record(1)], { extra: 1 }), Object.assign([record(1)], { [Symbol('extra')]: 1 }), [null], [undefined], [() => 1]]) rejects('INVALID_LOCATION', buildIdentityIndex, state(2), rows);
  const circular = record(1);
  circular.location = circular;
  rejects('INVALID_LOCATION', buildIdentityIndex, state(2), [circular]);
  const cyclicRef = ref(1);
  cyclicRef.matchId = cyclicRef;
  rejects('INVALID_IDENTITY_REF', retireInstanceId, state(2), cyclicRef);
  const shared = zone();
  const input = frozen([record(1, shared), record(2, shared)]);
  const built = value(buildIdentityIndex, frozen(state(3)), input);
  assert.notEqual(built.entries[0].location, built.entries[1].location);
  built.entries[0].location.zone = 'ban';
  assert.equal(built.entries[1].location.zone, 'hand');
  assert.equal(input[0].location.zone, 'hand');
  const located = value(findIdentityEntry, frozen(index([record(1)])), frozen(ref(1)));
  located.identity.instanceId = 'i:9';
  assert.equal(value(findIdentityEntry, index([record(1)]), ref(1)).identity.instanceId, 'i:1');
  const allocated = value(allocateInstanceId, frozen(state(3, ['i:1'])));
  allocated.state.retiredIds.push('i:2');
  assert.deepEqual(value(retireInstanceId, frozen(state(3)), frozen(ref(1))).retiredIds, ['i:1']);
  const reflectionFailure = new Error('reflection');
  assert.throws(() => allocateInstanceId(new Proxy({}, { ownKeys() { throw reflectionFailure; } })), error => error === reflectionFailure);
});

test('S01-12', () => {
  const rows = [record(1, board(3)), record(2, mount(ref(1), 7)), record(3, zone())];
  const left = value(buildIdentityIndex, state(4), rows);
  const right = value(buildIdentityIndex, state(4), [rows[2], rows[0], rows[1]]);
  assert.deepEqual(left, right);
  assert.deepEqual(value(buildIdentityIndex, state(4), rows), left);
  const found = value(findIdentityEntry, left, ref(2));
  found.location.host.instanceId = 'i:99';
  assert.equal(left.entries[1].location.host.instanceId, 'i:1');
  assert.equal(value(findIdentityEntry, left, ref(99)), null);
  rejects('INVALID_LOCATION', findIdentityEntry, { ...left, extra: 1 }, ref(99));
  rejects('MATCH_MISMATCH', findIdentityEntry, index([{ ...record(1), identity: ref(1, 'other') }]), ref(99));
  rejects('INVALID_LOCATION', findIdentityEntry, index([record(2), record(1)]), ref(99));
  rejects('DUPLICATE_INSTANCE', findIdentityEntry, index([record(1), record(1)]), ref(99));
  rejects('INVALID_LOCATION', findIdentityEntry, index([{ ...record(1), extra: 1 }]), ref(99));
  rejects('DUPLICATE_LOCATION', findIdentityEntry, index([record(1, board()), record(2, board())]), ref(99));
  rejects('MISSING_HOST', findIdentityEntry, index([record(1), record(2, mount(ref(3)))]), ref(99));
  rejects('MOUNT_CYCLE', findIdentityEntry, index([record(1), record(2, mount(ref(2)))]), ref(99));
  rejects('INVALID_LOCATION', findIdentityEntry, index([record(1), record(2, mount(ref(1)), 'seat-b', 'seat-b')]), ref(99));
  rejects('INVALID_IDENTITY_REF', findIdentityEntry, index([record(1), { ...record(2), identity: { matchId: 'match-a', instanceId: 'i:02' } }]), ref(99));
  const handmade = index([record(Number.MAX_SAFE_INTEGER, zone('ban', 'outside'), 'outside', 'outside')]);
  assert.equal(value(findIdentityEntry, handmade, ref(Number.MAX_SAFE_INTEGER)).ownerSeat, 'outside');
});
