import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeClientMessage, LIMITS, parseClientMessage, parseServerMessage, sanitizeGuestName } from '../src/network/protocol.js';

const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const send = message => encodeClientMessage(message);

test('a client message is read once its type, fields and sizes are right', () => {
  const hello = parseClientMessage(send({ t: 'hello', token, name: 'ゆうき' }));
  assert.deepEqual(hello, { ok: true, value: { t: 'hello', token, name: 'ゆうき' } });
  assert.equal(parseClientMessage(send({ t: 'hello', token, name: 'a', haveRevision: 12 })).value.haveRevision, 12);
  const cmd = parseClientMessage(send({ t: 'cmd', commandId: 'c:1', expectedRevision: 0, action: { type: 'endTurn' } }));
  assert.equal(cmd.ok, true);
  assert.equal(parseClientMessage(send({ t: 'bye' })).ok, true);
  assert.equal(parseClientMessage(send({ t: 'plan', rid: 'p1', expectedRevision: 3, actionId: 'action:3:2',
    selections: [{ requestId: 'req', optionIds: ['a'] }] })).ok, true);
  assert.equal(parseClientMessage(send({ t: 'inspect', rid: 'i1', ref: `r:${'0'.repeat(32)}` })).ok, true);
});

test('anything outside the contract is refused with a reason code', () => {
  const bad = text => parseClientMessage(text).error?.code;
  assert.equal(bad('{broken'), 'BAD_MESSAGE');
  assert.equal(bad(JSON.stringify({ t: 'hello', token, name: 'a' })), 'BAD_MESSAGE', 'no version');
  assert.equal(bad(JSON.stringify({ v: 2, t: 'bye' })), 'BAD_MESSAGE', 'wrong version');
  assert.equal(bad(send({ t: 'nope' })), 'BAD_MESSAGE');
  assert.equal(bad(send({ t: 'hello', token, name: 'a', actorSeat: 'seat-x' })), 'BAD_MESSAGE', 'a seat claim is an unknown field');
  assert.equal(bad(send({ t: 'hello', token: 'short', name: 'a' })), 'BAD_MESSAGE');
  assert.equal(bad(send({ t: 'hello', name: 'a' })), 'BAD_MESSAGE', 'missing token');
  assert.equal(bad(send({ t: 'cmd', commandId: 'c 1', expectedRevision: 0, action: { type: 'endTurn' } })), 'BAD_MESSAGE', 'spaces in an id');
  assert.equal(bad(send({ t: 'cmd', commandId: 'c1', expectedRevision: -1, action: { type: 'endTurn' } })), 'BAD_MESSAGE');
  assert.equal(bad(send({ t: 'cmd', commandId: 'c1', expectedRevision: 0, action: [] })), 'BAD_MESSAGE');
  assert.equal(bad(send({ t: 'cmd', commandId: 'c1', expectedRevision: 0, action: { kind: 'x' } })), 'BAD_MESSAGE', 'an action needs a type');
  assert.equal(bad(send({ t: 'inspect', rid: 'i', ref: 'r:short' })), 'BAD_MESSAGE');
  assert.equal(bad(send({ t: 'bye', extra: 1 })), 'BAD_MESSAGE');
  assert.equal(bad(42), 'BAD_MESSAGE', 'text frames only');
});

test('the size limit counts UTF-8 bytes, before the text is parsed', () => {
  const padding = 'あ'.repeat(3000); // 9,000 bytes, 3,000 characters
  const big = send({ t: 'hello', token, name: 'a', padding });
  assert.ok(big.length < LIMITS.maxMessageBytes && new TextEncoder().encode(big).length > LIMITS.maxMessageBytes);
  assert.equal(parseClientMessage(big).error.code, 'MESSAGE_TOO_LARGE');
  assert.equal(parseClientMessage('x'.repeat(LIMITS.maxMessageBytes + 1)).error.code, 'MESSAGE_TOO_LARGE');
});

test('a deck is a start deck id or a bounded recipe', () => {
  const ready = deck => parseClientMessage(send({ t: 'ready', userId: 'doors_zx', deck })).ok;
  assert.equal(ready({ kind: 'start', deckId: 'start-red' }), true);
  assert.equal(ready({ kind: 'custom', recipe: [['STD-001', 3]] }), true);
  assert.equal(ready({ kind: 'custom', recipe: [] }), false);
  assert.equal(ready({ kind: 'custom', recipe: [['STD-001', 0]] }), false);
  assert.equal(ready({ kind: 'custom', recipe: [['STD-001', 1.5]] }), false);
  assert.equal(ready({ kind: 'custom', recipe: Array.from({ length: 101 }, (_, index) => [`STD-${index}`, 1]) }), false);
  assert.equal(ready({ kind: 'start', deckId: 'start-red', extra: 1 }), false);
  assert.equal(ready({ kind: 'mystery' }), false);
});

test('a server frame needs the version and a known type', () => {
  assert.equal(parseServerMessage(JSON.stringify({ v: 1, t: 'state', revision: 1 })).ok, true);
  assert.equal(parseServerMessage(JSON.stringify({ v: 1, t: 'hello' })).ok, false, 'hello is a client type');
  assert.equal(parseServerMessage(JSON.stringify({ v: 9, t: 'state' })).ok, false);
  assert.equal(parseServerMessage('nope').ok, false);
});

test('a guest name loses control characters and is cut at 16 characters, not 16 code units', () => {
  assert.equal(sanitizeGuestName('  ゆうき\u0000‮  たろう '), 'ゆうき たろう');
  assert.equal(sanitizeGuestName('\u0007\u0000'), 'ゲスト');
  assert.equal(sanitizeGuestName(''), 'ゲスト');
  assert.equal([...sanitizeGuestName('😀'.repeat(40))].length, 16);
  assert.equal(sanitizeGuestName('a'.repeat(40)).length, 16);
  assert.equal(sanitizeGuestName(null, 'x'), 'x');
});
