import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRuntimeReferenceState, advanceRuntimeReferenceState, findRuntimeCardReference, lookupRuntimeCardReference,
  planRuntimeReferenceTransition, advanceRuntimeReferenceTransition
} from '../src/game/runtime/references.js';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeIdentityIndex } from '../src/game/runtime/bridge.js';
import { addSandboxCardToHand, installCard, playCard, destroyCard } from '../src/game/engine.js';
import { projectRuntimeView } from '../src/game/runtime/projection.js';

const ref = (serial, matchId = 'match-a') => ({ matchId, instanceId: `i:${serial}` });
const token = serial => `r:${serial.toString(16).padStart(32, '0')}`;
const tokens = (count, start = 1) => Array.from({ length: count }, (_, index) => token(start + index));
const zone = (name, seatId = 'seat-a') => ({ kind: 'zone', seatId, zone: name });
const board = (position, seatId = 'seat-a', name = 'front') => ({ kind: 'board', seatId, zone: name, position });
const mount = (host, order = 1) => ({ kind: 'mounted', host: ref(host), order, role: 'mount' });
const card = (serial, location, faceDown = false, ownerSeat = 'seat-a', controllerSeat = 'seat-a') => ({ identity: ref(serial), ownerSeat, controllerSeat, location, faceDown });
function frame() {
  return { matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], cards: [
    card(1, zone('hand'), false, 'seat-b'), card(2, zone('deck')),
    card(3, board(1), true), card(4, zone('registry')), card(5, zone('trash'), true),
    card(6, zone('ban')), card(7, board(2)), card(8, mount(7), false, 'seat-b'),
    card(9, mount(7, 2), true), card(10, mount(8)), card(11, { kind: 'inflight', storageKey: 'trusted-flight' })
  ] };
}
const clone = value => structuredClone(value);
function snapshot(input, seen = new Map()) {
  if (input === null || typeof input !== 'object') return input;
  if (seen.has(input)) return { shared: seen.get(input) };
  seen.set(input, seen.size);
  return { prototype: Object.getPrototypeOf(input), descriptors: Reflect.ownKeys(input).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
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
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
const failure = (code, api, ...args) => assert.deepEqual(invoke(api, ...args), { ok: false, error: { code } });
const create = current => value(createRuntimeReferenceState, { frame: current, newRefs: tokens(13) });
const planTransition = (state, beforeFrame, afterFrame) => value(planRuntimeReferenceTransition, state, { beforeFrame, afterFrame });
const commitTransition = (state, beforeFrame, afterFrame, start = 100) => {
  const plan = planTransition(state, beforeFrame, afterFrame);
  return value(advanceRuntimeReferenceTransition, state, {
    beforeFrame, afterFrame, newRefs: tokens(plan.newRefCount, start)
  });
};
const find = (state, current, serial, viewerSeat = 'seat-a') => value(findRuntimeCardReference, state, { frame: current, matchId: current.matchId, viewerSeat, identity: ref(serial, current.matchId) }).cardRef;
const lookupArgs = (current, cardRef, viewerSeat = 'seat-a') => ({ frame: current, matchId: current.matchId, viewerSeat, cardRef });
function freeze(input) {
  if (input && typeof input === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if (Object.hasOwn(descriptor, 'value')) freeze(descriptor.value);
    Object.freeze(input);
  }
  return input;
}

test('S02-REF-01: issuance order and trackable rules cover both viewers and foreign owners', () => {
  const current = frame(); const state = create(current);
  assert.deepEqual(Object.keys(state), ['matchId', 'seatIds', 'issuedRefs', 'entries']);
  assert.deepEqual(state.entries.map(row => [row.identity.instanceId, row.viewerSeat, row.cardRef]), [
    ['i:1', 'seat-a', token(1)], ...[3, 4, 6, 7, 8, 10].flatMap((serial, index) => [
      [`i:${serial}`, 'seat-a', token(2 + index * 2)], [`i:${serial}`, 'seat-b', token(3 + index * 2)]
    ])
  ]);
  assert.notEqual(find(state, current, 3), find(state, current, 3, 'seat-b'));
  for (const serial of [2, 5, 9, 11]) for (const viewerSeat of current.seatIds) failure('REF_INVALID_REFERENCE', findRuntimeCardReference, state, { frame: current, matchId: current.matchId, viewerSeat, identity: ref(serial) });
  failure('REF_INVALID_REFERENCE', findRuntimeCardReference, state, { frame: current, matchId: current.matchId, viewerSeat: 'seat-b', identity: ref(1) });
  assert.deepEqual(value(lookupRuntimeCardReference, state, lookupArgs(current, token(1))), { identity: ref(1) });
});

test('S02-REF-02: board face flip, stored position and controller change preserve references', () => {
  const initial = frame(); const state = create(initial); const current = clone(initial);
  current.cards[2].faceDown = false;
  current.cards[2].location = board(3, 'seat-b', 'back'); current.cards[2].controllerSeat = 'seat-b';
  const advanced = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [], newRefs: [] });
  assert.deepEqual(advanced, state);
  for (const viewer of current.seatIds) assert.equal(find(advanced, current, 3, viewer), find(state, initial, 3, viewer));
});

test('S02-REF-03: mounted descendants require every ancestor face up without hiding the board host', () => {
  const initial = frame(); const state = create(initial); const current = clone(initial);
  current.cards[6].faceDown = true;
  const advanced = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [], newRefs: [] });
  assert.equal(advanced.entries.length, 9);
  assert.equal(find(advanced, current, 7), find(state, initial, 7));
  for (const serial of [8, 10]) failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, state, lookupArgs(current, find(state, initial, serial)));
  current.cards[6].faceDown = false;
  const exposed = value(advanceRuntimeReferenceState, advanced, { frame: current, invalidatedIdentities: [], newRefs: tokens(4, 20) });
  assert.equal(exposed.entries.length, 13);
  assert.notEqual(find(exposed, current, 8), find(state, initial, 8));
  assert.equal(exposed.issuedRefs.length, 17);
});

test('S02-REF-04: hidden ingress and republication revoke then allocate fresh viewer mappings', () => {
  const initial = frame(); const state = create(initial); const current = clone(initial);
  current.cards[2].location = zone('hand');
  const hidden = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(3)], newRefs: [token(20)] });
  assert.equal(find(hidden, current, 3), token(20));
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, hidden, lookupArgs(current, find(state, initial, 3)));
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, hidden, lookupArgs(current, find(state, initial, 3, 'seat-b'), 'seat-b'));
  current.cards[2].location = zone('deck');
  const shuffled = value(advanceRuntimeReferenceState, hidden, { frame: current, invalidatedIdentities: [ref(3)], newRefs: [] });
  current.cards[2].location = board(1);
  const publicAgain = value(advanceRuntimeReferenceState, shuffled, { frame: current, invalidatedIdentities: [], newRefs: tokens(2, 21) });
  assert.equal(find(publicAgain, current, 3), token(21));
  assert.equal(find(publicAgain, current, 3, 'seat-b'), token(22));
  assert.equal(publicAgain.issuedRefs.length, 16);
});

test('S02-REF-05: explicit invalidation rotates handles even with the exact same final frame', () => {
  const current = frame(); const state = create(current);
  const rotated = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(3)], newRefs: tokens(2, 20) });
  for (const viewer of current.seatIds) {
    assert.notEqual(find(rotated, current, 3, viewer), find(state, current, 3, viewer));
    failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, rotated, lookupArgs(current, find(state, current, 3, viewer), viewer));
  }
  assert.equal(find(rotated, current, 4), find(state, current, 4));
  const unchanged = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(999)], newRefs: [] });
  assert.deepEqual(unchanged, state);
});

test('S02-REF-06: disappearance and current hidden storage are uniform lookup failures', () => {
  const initial = frame(); const state = create(initial);
  const hidden = clone(initial); hidden.cards[3].faceDown = true;
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, state, lookupArgs(hidden, find(state, initial, 4)));
  const removed = clone(initial); removed.cards.splice(3, 1);
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, state, lookupArgs(removed, find(state, initial, 4)));
  const advanced = value(advanceRuntimeReferenceState, state, { frame: removed, invalidatedIdentities: [], newRefs: [] });
  assert.equal(advanced.entries.length, 11);
  assert.deepEqual(advanced.issuedRefs, state.issuedRefs);
});

test('S02-REF-07: other match/viewer, unknown or malformed-string handles disclose no reason', () => {
  const current = frame(); const state = create(current);
  for (const args of [
    { ...lookupArgs(current, token(1)), matchId: 'other' }, lookupArgs(current, token(1), 'outside'),
    lookupArgs(current, token(1), 'seat-b'), lookupArgs(current, token(999)), lookupArgs(current, 'not-a-reference')
  ]) failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, state, args);
  const other = clone(current); other.matchId = 'other';
  for (const row of other.cards) { row.identity.matchId = 'other'; if (row.location.kind === 'mounted') row.location.host.matchId = 'other'; }
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, state, lookupArgs(other, token(1)));
  failure('REF_INVALID_REFERENCE', findRuntimeCardReference, state, { frame: other, matchId: 'other', viewerSeat: 'seat-a', identity: ref(1, 'other') });
  failure('REF_INVALID_FRAME', advanceRuntimeReferenceState, state, { frame: other, invalidatedIdentities: [], newRefs: [] });
});

test('S02-REF-08: find refuses missing mappings instead of issuing, lookup never repairs', () => {
  const current = frame(); const state = create(current);
  state.entries = state.entries.filter(entry => entry.identity.instanceId !== 'i:3');
  failure('REF_MAPPING_MISSING', findRuntimeCardReference, state, { frame: current, matchId: current.matchId, viewerSeat: 'seat-a', identity: ref(3) });
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, state, lookupArgs(current, token(2)));
  const repaired = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [], newRefs: tokens(2, 20) });
  assert.equal(find(repaired, current, 3), token(20));
});

test('S02-REF-09: exact batch size, collisions and ever-issued reuse fail atomically', () => {
  const current = frame(); const state = create(current);
  for (const newRefs of [[], tokens(12), tokens(14)]) failure('REF_INVALID_TRANSITION', createRuntimeReferenceState, { frame: current, newRefs });
  const duplicates = tokens(13); duplicates[12] = duplicates[0];
  failure('REF_COLLISION', createRuntimeReferenceState, { frame: current, newRefs: duplicates });
  failure('REF_COLLISION', advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(3)], newRefs: [token(2), token(20)] });
  const rotated = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(3)], newRefs: tokens(2, 20) });
  failure('REF_COLLISION', advanceRuntimeReferenceState, rotated, { frame: current, invalidatedIdentities: [ref(3)], newRefs: [token(2), token(21)] });
  failure('REF_INVALID_TRANSITION', advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(3), ref(3)], newRefs: tokens(2, 20) });
  failure('REF_INVALID_TRANSITION', advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [ref(999, 'other')], newRefs: [] });
});

test('S02-REF-10: reference format is exactly lowercase 128-bit text and primitive strings', () => {
  const current = frame();
  for (const invalid of ['r:ABCDEF0123456789abcdef0123456789', `r:${'a'.repeat(31)}`, `r:${'a'.repeat(33)}`, token(1) + '\n', token(1).slice(2), 1, new String(token(1)), null]) {
    const newRefs = tokens(13); newRefs[0] = invalid;
    failure('REF_INVALID_INPUT', createRuntimeReferenceState, { frame: current, newRefs });
  }
  const empty = { matchId: 'm', seatIds: ['a', 'b'], cards: [] };
  assert.deepEqual(value(createRuntimeReferenceState, { frame: empty, newRefs: [] }), { matchId: 'm', seatIds: ['a', 'b'], issuedRefs: [], entries: [] });
});

test('S02-REF-11: malformed table, duplicate active pairs and incomplete issued membership reject', () => {
  const current = frame(); const state = create(current);
  for (const change of [
    input => { input.extra = 1; }, input => { input.seatIds[1] = input.seatIds[0]; },
    input => input.issuedRefs.pop(), input => input.issuedRefs.push(input.issuedRefs[0]),
    input => input.entries.push(clone(input.entries[0])),
    input => { input.entries[1].cardRef = input.entries[0].cardRef; },
    input => { input.entries[0].identity.matchId = 'other'; },
    input => { input.entries[0].viewerSeat = 'outside'; },
    input => { input.entries[0].identity.instanceId = 'i:01'; }
  ]) {
    const candidate = clone(state); change(candidate);
    failure('REF_INVALID_STATE', lookupRuntimeCardReference, candidate, lookupArgs(current, token(1)));
  }
});

test('S02-REF-12: frame order, locations, uniqueness, seats and mounted relations are strict', () => {
  const initial = frame();
  for (const change of [
    input => { input.extra = 1; }, input => { input.cards[0].faceDown = 0; },
    input => input.cards.reverse(), input => input.cards.push(clone(input.cards[0])),
    input => { input.cards[0].ownerSeat = 'outside'; },
    input => { input.cards[0].identity.matchId = 'other'; },
    input => { input.cards[2].location.position = -0; },
    input => { input.cards[6].location.position = 1; },
    input => { input.cards[7].location.host = ref(999); },
    input => { input.cards[7].location.host = ref(10); },
    input => { input.cards[7].controllerSeat = 'seat-b'; },
    input => { input.cards[7].location.order = 0; },
    input => { input.cards[7].location.role = 'Code'; }
  ]) {
    const candidate = clone(initial); change(candidate);
    failure('REF_INVALID_FRAME', createRuntimeReferenceState, { frame: candidate, newRefs: tokens(13) });
  }
});

test('S02-REF-13: exact input shapes, dense arrays and canonical invalidation identities', () => {
  const current = frame(); const state = create(current);
  for (const input of [null, {}, { frame: current, newRefs: tokens(13), extra: 1 }, Object.assign(Object.create(null), { frame: current, newRefs: tokens(13) })]) failure('REF_INVALID_INPUT', createRuntimeReferenceState, input);
  for (const invalidatedIdentities of [[ref(0)], [{ ...ref(1), extra: 1 }], [{ matchId: 'match-a', instanceId: 'i:01' }], [, ref(1)]]) failure('REF_INVALID_INPUT', advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities, newRefs: [] });
  for (const change of [input => { input.cards = [, ...input.cards]; }, input => { input.cards.extra = 1; }, input => { input.cards[Symbol('extra')] = 1; }]) {
    const candidate = clone(current); change(candidate);
    failure('REF_INVALID_FRAME', createRuntimeReferenceState, { frame: candidate, newRefs: tokens(13) });
  }
  const newRefs = tokens(13); newRefs.extra = 1;
  failure('REF_INVALID_INPUT', createRuntimeReferenceState, { frame: current, newRefs });
});

test('S02-REF-14: pure repeat calls, frozen data and returned copies have no shared mutable data', () => {
  const current = freeze(frame()); const newRefs = freeze(tokens(13));
  const first = value(createRuntimeReferenceState, freeze({ frame: current, newRefs }));
  const second = value(createRuntimeReferenceState, { frame: current, newRefs });
  assert.deepEqual(first, second);
  first.seatIds.reverse(); first.issuedRefs.pop(); first.entries[0].identity.instanceId = 'i:99';
  assert.deepEqual(second, create(current));
  const frozenState = freeze(second);
  const advanced = value(advanceRuntimeReferenceState, frozenState, freeze({ frame: current, invalidatedIdentities: [], newRefs: [] }));
  advanced.entries[0].identity.matchId = 'changed';
  assert.equal(frozenState.entries[0].identity.matchId, 'match-a');
  const found = value(lookupRuntimeCardReference, frozenState, freeze(lookupArgs(current, token(1))));
  found.identity.instanceId = 'i:99';
  assert.deepEqual(value(lookupRuntimeCardReference, frozenState, lookupArgs(current, token(1))), { identity: ref(1) });
});

test('S02-REF-15: property getters never execute and reflection exceptions propagate', () => {
  const current = frame(); const state = create(current); let called = 0;
  const getter = { enumerable: true, configurable: true, get() { called += 1; throw new Error('getter'); } };
  const args = { frame: current, newRefs: tokens(13) }; Object.defineProperty(args, 'newRefs', getter);
  failure('REF_INVALID_INPUT', createRuntimeReferenceState, args);
  const badFrame = clone(current); Object.defineProperty(badFrame.cards[0], 'faceDown', getter);
  failure('REF_INVALID_FRAME', createRuntimeReferenceState, { frame: badFrame, newRefs: tokens(13) });
  const badState = clone(state); Object.defineProperty(badState.entries[0], 'cardRef', getter);
  failure('REF_INVALID_STATE', lookupRuntimeCardReference, badState, lookupArgs(current, token(1)));
  const badArray = tokens(13); Object.defineProperty(badArray, '0', getter);
  failure('REF_INVALID_INPUT', createRuntimeReferenceState, { frame: current, newRefs: badArray });
  assert.equal(called, 0);
  const reflection = new Error('reflection');
  for (const trap of ['ownKeys', 'getPrototypeOf', 'getOwnPropertyDescriptor']) assert.throws(() => createRuntimeReferenceState(new Proxy({ frame: current, newRefs: tokens(13) }, { [trap]() { throw reflection; } })), error => error === reflection);
});

test('S02-REF-16: actual session/factory/bridge cards provide public tracking frames', () => {
  const created = createRuntimeSession({ matchId: 'real', seatIds: ['seat-a', 'seat-b'], seed: 0, ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-022', 12]], aiDeckRecipe: [['STD-022', 12]] } });
  assert.equal(created.ok, true);
  const engine = created.value.engineState;
  const authorityFrame = () => {
    const built = buildRuntimeIdentityIndex(engine); assert.equal(built.ok, true);
    const physical = new Map();
    const collect = card => { physical.set(card.identity.instanceId, card); card.mounted.forEach(collect); };
    for (const player of Object.values(engine.players)) for (const zoneName of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) player[zoneName].forEach(collect);
    return { matchId: built.value.matchId, seatIds: [...engine.runtimeContext.seatIds], cards: built.value.entries.map(entry => ({ ...entry, faceDown: physical.get(entry.identity.instanceId).faceDown ?? false })) };
  };
  let current = authorityFrame();
  let state = value(createRuntimeReferenceState, { frame: current, newRefs: tokens(engine.players.player.hand.length + engine.players.ai.hand.length) });
  const own = engine.players.player.hand[0];
  const oldRef = value(findRuntimeCardReference, state, { frame: current, matchId: 'real', viewerSeat: 'seat-a', identity: { ...own.identity } }).cardRef;
  assert.equal(installCard(engine, 'player', own.uid), true);
  current = authorityFrame();
  state = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [], newRefs: [token(100)] });
  assert.equal(value(findRuntimeCardReference, state, { frame: current, matchId: 'real', viewerSeat: 'seat-a', identity: { ...own.identity } }).cardRef, oldRef);
  assert.equal(addSandboxCardToHand(engine, 'player', 'STD-020'), true);
  const host = engine.players.player.hand.at(-1);
  assert.equal(playCard(engine, 'player', host.uid, { free: true, force: true, ignoreColor: true }), true);
  assert.equal(addSandboxCardToHand(engine, 'player', 'STD-078'), true);
  const child = engine.players.player.hand.at(-1);
  assert.equal(playCard(engine, 'player', child.uid, { free: true, force: true, ignoreColor: true, underUid: host.uid }), true);
  current = authorityFrame();
  state = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [], newRefs: tokens(4, 101) });
  const childRef = value(findRuntimeCardReference, state, { frame: current, matchId: 'real', viewerSeat: 'seat-b', identity: { ...child.identity } }).cardRef;
  assert.deepEqual(value(lookupRuntimeCardReference, state, { frame: current, matchId: 'real', viewerSeat: 'seat-b', cardRef: childRef }), { identity: { ...child.identity } });
  assert.equal(destroyCard(engine, 'player', host.uid, { suppressReplacement: true }), true);
  current = authorityFrame();
  const moved = value(advanceRuntimeReferenceState, state, { frame: current, invalidatedIdentities: [], newRefs: [] });
  assert.equal(value(findRuntimeCardReference, moved, { frame: current, matchId: 'real', viewerSeat: 'seat-b', identity: { ...host.identity } }).cardRef, state.entries.find(entry => entry.viewerSeat === 'seat-b' && entry.identity.instanceId === host.identity.instanceId).cardRef);
});

test('S02-REF-T01: planner exposes exact immutable plan and commit preserves an unchanged frame', () => {
  const before = frame(); const state = create(before);
  const result = value(planRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: clone(before) });
  assert.deepEqual(Object.keys(result), ['invalidatedIdentities', 'newRefCount']);
  assert.deepEqual(result, { invalidatedIdentities: [], newRefCount: 0 });
  assert.deepEqual(commitTransition(state, before, clone(before)), state);
});

test('S02-REF-T02: public-to-own-hand loss invalidates every viewer mapping before reissue', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  const old = state.entries.filter(entry => entry.identity.instanceId === 'i:3');
  after.cards.find(item => item.identity.instanceId === 'i:3').location = zone('hand');
  const plan = planTransition(state, before, after);
  assert.deepEqual(plan.invalidatedIdentities, [ref(3)]);
  assert.equal(plan.newRefCount, 1);
  const moved = commitTransition(state, before, after, 20);
  assert.deepEqual(moved.entries.filter(entry => entry.identity.instanceId === 'i:3').map(entry => entry.viewerSeat), ['seat-a']);
  assert.notEqual(moved.entries.find(entry => entry.identity.instanceId === 'i:3').cardRef, old.find(entry => entry.viewerSeat === 'seat-a').cardRef);
  for (const entry of old) failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, moved, lookupArgs(after, entry.cardRef, entry.viewerSeat));
  assert.equal(moved.issuedRefs.length, state.issuedRefs.length + 1);
});

test('S02-REF-T03: own-hand-to-public preserves the owner ref and allocates the other viewer', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  const existing = find(state, before, 1);
  const card1 = after.cards.find(item => item.identity.instanceId === 'i:1');
  card1.location = board(4); card1.controllerSeat = 'seat-a';
  const plan = planTransition(state, before, after);
  assert.deepEqual(plan, { invalidatedIdentities: [], newRefCount: 1 });
  const moved = commitTransition(state, before, after, 30);
  assert.equal(find(moved, after, 1, 'seat-a'), existing);
  assert.equal(find(moved, after, 1, 'seat-b'), token(30));
});

test('S02-REF-T04: hand-to-deck invalidates; deck reorder does not affect identities', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  after.cards.find(item => item.identity.instanceId === 'i:1').location = zone('deck');
  const plan = planTransition(state, before, after);
  assert.deepEqual(plan, { invalidatedIdentities: [ref(1)], newRefCount: 0 });
  const moved = commitTransition(state, before, after);
  assert.equal(moved.entries.some(entry => entry.identity.instanceId === 'i:1'), false);
  assert.equal(moved.issuedRefs.length, state.issuedRefs.length);
  // Deck order is deliberately absent from reference descriptors, so a reorder keeps this endpoint identical.
  assert.deepEqual(planTransition(moved, after, clone(after)), { invalidatedIdentities: [], newRefCount: 0 });
});

test('S02-REF-T05: deck-to-foreign-controller hand adds only that controller mapping', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  const card2 = after.cards.find(item => item.identity.instanceId === 'i:2');
  card2.location = zone('hand', 'seat-b'); card2.controllerSeat = 'seat-b';
  const plan = planTransition(state, before, after);
  assert.deepEqual(plan, { invalidatedIdentities: [], newRefCount: 1 });
  const moved = commitTransition(state, before, after, 40);
  assert.equal(find(moved, after, 2, 'seat-b'), token(40));
  failure('REF_INVALID_REFERENCE', findRuntimeCardReference, moved, { frame: after, matchId: after.matchId, viewerSeat: 'seat-a', identity: ref(2) });
});

test('S02-REF-T06: hand controller transfer invalidates the old identity mapping globally', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  const old = find(state, before, 1, 'seat-a');
  const card1 = after.cards.find(item => item.identity.instanceId === 'i:1');
  card1.location = zone('hand', 'seat-b'); card1.controllerSeat = 'seat-b';
  const plan = planTransition(state, before, after);
  assert.deepEqual(plan, { invalidatedIdentities: [ref(1)], newRefCount: 1 });
  const moved = commitTransition(state, before, after, 50);
  assert.equal(find(moved, after, 1, 'seat-b'), token(50));
  failure('REF_INVALID_REFERENCE', lookupRuntimeCardReference, moved, lookupArgs(after, old, 'seat-a'));
});

test('S02-REF-T07: board face, slot, controller and owner changes preserve both public refs', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  const prior = state.entries.filter(entry => entry.identity.instanceId === 'i:3');
  const changed = after.cards.find(item => item.identity.instanceId === 'i:3');
  changed.faceDown = false; changed.ownerSeat = 'seat-b'; changed.controllerSeat = 'seat-b';
  changed.location = board(7, 'seat-b', 'back');
  assert.deepEqual(planTransition(state, before, after), { invalidatedIdentities: [], newRefCount: 0 });
  const moved = commitTransition(state, before, after);
  for (const entry of prior) assert.equal(find(moved, after, 3, entry.viewerSeat), entry.cardRef);
});

test('S02-REF-T08: a hidden mounted ancestor invalidates visible descendants once, then reveal allocates fresh refs', () => {
  const before = frame(); const state = create(before); const hidden = clone(before);
  hidden.cards.find(item => item.identity.instanceId === 'i:7').faceDown = true;
  assert.deepEqual(planTransition(state, before, hidden), { invalidatedIdentities: [ref(8), ref(10)], newRefCount: 0 });
  const obscured = commitTransition(state, before, hidden);
  const revealed = clone(hidden); revealed.cards.find(item => item.identity.instanceId === 'i:7').faceDown = false;
  assert.deepEqual(planTransition(obscured, hidden, revealed), { invalidatedIdentities: [], newRefCount: 4 });
  const visible = commitTransition(obscured, hidden, revealed, 60);
  assert.equal(find(visible, revealed, 8, 'seat-a'), token(60));
  assert.equal(find(visible, revealed, 8, 'seat-b'), token(61));
  assert.equal(find(visible, revealed, 10, 'seat-a'), token(62));
  assert.equal(find(visible, revealed, 10, 'seat-b'), token(63));
  assert.notEqual(find(visible, revealed, 8), find(state, before, 8));
  assert.notEqual(find(visible, revealed, 10, 'seat-b'), find(state, before, 10, 'seat-b'));
});

test('S02-REF-T09: mounted role and order changes preserve references when visibility remains', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  const child = after.cards.find(item => item.identity.instanceId === 'i:8');
  child.location = mount(7, 3); child.location.role = 'layered';
  assert.deepEqual(planTransition(state, before, after), { invalidatedIdentities: [], newRefCount: 0 });
  const moved = commitTransition(state, before, after);
  for (const viewer of before.seatIds) assert.equal(find(moved, after, 8, viewer), find(state, before, 8, viewer));
});

test('S02-REF-T10: disappearance invalidates and a newly public identity allocates; inflight stays untracked', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  after.cards = after.cards.filter(item => item.identity.instanceId !== 'i:3');
  after.cards.push(card(12, board(4)));
  const plan = planTransition(state, before, after);
  assert.deepEqual(plan, { invalidatedIdentities: [ref(3)], newRefCount: 2 });
  const moved = commitTransition(state, before, after, 70);
  assert.equal(find(moved, after, 12), token(70));
  assert.equal(find(moved, after, 12, 'seat-b'), token(71));
  for (const viewer of after.seatIds) failure('REF_INVALID_REFERENCE', findRuntimeCardReference, moved, { frame: after, matchId: after.matchId, viewerSeat: viewer, identity: ref(11) });
});

test('S02-REF-T11: planner requires exact active-pair alignment with the before frame', () => {
  const before = frame(); const state = create(before);
  const missing = clone(state); missing.entries = missing.entries.filter(entry => !(entry.identity.instanceId === 'i:3' && entry.viewerSeat === 'seat-a'));
  failure('REF_INVALID_TRANSITION', planRuntimeReferenceTransition, missing, { beforeFrame: before, afterFrame: clone(before) });
  const extra = clone(state); extra.issuedRefs.push(token(20)); extra.entries.push({ viewerSeat: 'seat-a', identity: ref(2), cardRef: token(20) });
  failure('REF_INVALID_TRANSITION', planRuntimeReferenceTransition, extra, { beforeFrame: before, afterFrame: clone(before) });
});

test('S02-REF-T12: transition error precedence is input, state, frame, scope, alignment, token, count, collision', () => {
  const before = frame(); const state = create(before); const unchanged = clone(before);
  failure('REF_INVALID_INPUT', planRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: unchanged, extra: true });
  let getterCalls = 0;
  const getterArgs = { beforeFrame: before };
  Object.defineProperty(getterArgs, 'afterFrame', { enumerable: true, get() { getterCalls += 1; return unchanged; } });
  failure('REF_INVALID_INPUT', planRuntimeReferenceTransition, state, getterArgs);
  const getterFrame = clone(unchanged);
  Object.defineProperty(getterFrame.cards[0], 'faceDown', { enumerable: true, get() { getterCalls += 1; return false; } });
  failure('REF_INVALID_FRAME', planRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: getterFrame });
  assert.equal(getterCalls, 0);
  const reflection = new Error('reflection');
  assert.throws(() => planRuntimeReferenceTransition(new Proxy(state, { ownKeys() { throw reflection; } }), { beforeFrame: before, afterFrame: unchanged }), error => error === reflection);
  failure('REF_INVALID_STATE', planRuntimeReferenceTransition, { ...state, extra: true }, { beforeFrame: before, afterFrame: unchanged });
  const badFrame = clone(before); badFrame.cards[0].faceDown = 1;
  failure('REF_INVALID_FRAME', planRuntimeReferenceTransition, state, { beforeFrame: badFrame, afterFrame: unchanged });
  const otherScope = clone(before); otherScope.matchId = 'other';
  failure('REF_INVALID_FRAME', planRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: otherScope });
  const missingAlignment = clone(state); missingAlignment.entries.pop();
  failure('REF_INVALID_TRANSITION', advanceRuntimeReferenceTransition, missingAlignment, { beforeFrame: before, afterFrame: unchanged, newRefs: [1] });
  const needsOne = clone(before); needsOne.cards.find(item => item.identity.instanceId === 'i:3').location = zone('hand');
  failure('REF_INVALID_INPUT', advanceRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: needsOne, newRefs: ['bad'] });
  failure('REF_INVALID_TRANSITION', advanceRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: needsOne, newRefs: [] });
  failure('REF_COLLISION', advanceRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: needsOne, newRefs: [token(1)] });
});

test('S02-REF-T13: transition APIs accept frozen data, return independent state and never mutate inputs', () => {
  const before = freeze(frame()); const state = freeze(create(before)); const after = freeze(clone(before));
  const frozenArgs = freeze({ beforeFrame: before, afterFrame: after });
  const planned = value(planRuntimeReferenceTransition, state, frozenArgs);
  planned.invalidatedIdentities.push(ref(999));
  const repeated = value(planRuntimeReferenceTransition, state, frozenArgs);
  assert.deepEqual(repeated, { invalidatedIdentities: [], newRefCount: 0 });
  const committed = value(advanceRuntimeReferenceTransition, state, freeze({ ...frozenArgs, newRefs: [] }));
  committed.entries[0].identity.instanceId = 'i:999';
  assert.equal(state.entries[0].identity.instanceId, 'i:1');
  assert.equal(before.cards[0].identity.instanceId, 'i:1');
});

test('S02-REF-T14: invalidations dedupe by identity, use numeric instance order and keep tombstones', () => {
  const before = frame(); const state = create(before); const after = clone(before);
  for (const instanceId of ['i:3', 'i:7']) after.cards.find(item => item.identity.instanceId === instanceId).location = zone('hand');
  const planned = planTransition(state, before, after);
  assert.deepEqual(planned, { invalidatedIdentities: [ref(3), ref(7), ref(8), ref(10)], newRefCount: 4 });
  const moved = commitTransition(state, before, after, 80);
  assert.deepEqual(moved.entries.filter(entry => ['i:3', 'i:7', 'i:8', 'i:10'].includes(entry.identity.instanceId)).map(entry => [entry.identity.instanceId, entry.viewerSeat, entry.cardRef]), [
    ['i:3', 'seat-a', token(80)], ['i:7', 'seat-a', token(81)], ['i:8', 'seat-a', token(82)], ['i:10', 'seat-a', token(83)]
  ]);
  assert.equal(moved.issuedRefs.length, state.issuedRefs.length + 4);
  assert.ok(moved.issuedRefs.includes(find(state, before, 3, 'seat-b')));
});

test('S02-REF-T15: an identical endpoint cannot reveal an unobserved hidden round trip', () => {
  const endpoint = frame(); const state = create(endpoint);
  // A public -> hidden -> public path between these identical snapshots is unobservable here.
  assert.deepEqual(planTransition(state, endpoint, clone(endpoint)), { invalidatedIdentities: [], newRefCount: 0 });
});

test('S02-REF-T16: live session bridge transition feeds the trusted projection without repair', () => {
  const created = createRuntimeSession({ matchId: 'live-transition', seatIds: ['seat-a', 'seat-b'], seed: 0, ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-022', 12]], aiDeckRecipe: [['STD-022', 12]] } });
  assert.equal(created.ok, true);
  const engine = created.value.engineState;
  const authorityFrame = () => {
    const built = buildRuntimeIdentityIndex(engine); assert.equal(built.ok, true);
    const physical = new Map();
    const collect = item => { physical.set(item.identity.instanceId, item); item.mounted.forEach(collect); };
    for (const player of Object.values(engine.players)) for (const zoneName of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) player[zoneName].forEach(collect);
    return { matchId: built.value.matchId, seatIds: [...engine.runtimeContext.seatIds], cards: built.value.entries.map(entry => ({ ...entry, faceDown: physical.get(entry.identity.instanceId).faceDown ?? false })) };
  };
  const before = authorityFrame();
  const state = value(createRuntimeReferenceState, { frame: before, newRefs: tokens(engine.players.player.hand.length + engine.players.ai.hand.length) });
  const installed = engine.players.player.hand[0];
  assert.equal(installCard(engine, 'player', installed.uid), true);
  const after = authorityFrame();
  const planned = planTransition(state, before, after);
  assert.deepEqual(planned.invalidatedIdentities, []);
  const advanced = value(advanceRuntimeReferenceTransition, state, { beforeFrame: before, afterFrame: after, newRefs: tokens(planned.newRefCount, 100) });
  const result = projectRuntimeView(engine, advanced, { matchId: 'live-transition', viewerSeat: 'seat-a', revision: 1 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.value.seats[0].registry.cards.some(item => item.definition.id === installed.id));
});
