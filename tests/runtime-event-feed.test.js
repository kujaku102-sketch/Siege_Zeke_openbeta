import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';

function match(mode = 'ai', gameOptions = {}) {
  const result = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'event-test', seatIds: ['a', 'b'], seed: 11,
    ruleVersion: '2.0', cardVersion: 'public', gameOptions: { mode, sandboxDeckSetup: mode === 'sandbox', ...gameOptions }
  } });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function submit(port, action, id = 'one') {
  const query = port.query().value;
  const result = port.submit({ commandId: id, expectedRevision: query.status.revision, action });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
test('event feed is detached, viewer scoped, cursor ordered and retry emits nothing', () => {
  const session = match();
  const a = session.port('a').value, b = session.port('b').value;
  const card = a.query().value.observation.seats[0].hand.cards[0];
  submit(a, { type: 'install', cardRef: card.cardRef });
  const first = a.events().value.events, second = b.events().value.events;
  assert.ok(first.length > 0);
  assert.ok(second.length > 0);
  assert.equal(first[0].source.definitionId, card.definition.id);
  assert.equal(second[0].source.definitionId, card.definition.id);
  assert.notEqual(first[0].source.cardRef, second[0].source.cardRef);
  const serialized = JSON.stringify(second);
  assert.doesNotMatch(serialized, /"(?:uid|identity|cardUid|playerId|continuation|rngState|candidates)"/);
  const cursor = first.at(-1).eventId;
  first[0].type = 'spoofed';
  assert.equal(a.events().value.events[0].type, 'action_committed');
  assert.deepEqual(a.events({ afterEventId: cursor }), { ok: true, value: { cursor, events: [] } });
  assert.equal(a.events({ afterEventId: 'foreign' }).error.code, 'UNKNOWN_EVENT_CURSOR');
  a.submit({ commandId: 'one', expectedRevision: 0, action: { type: 'install', cardRef: card.cardRef } });
  assert.deepEqual(a.events({ afterEventId: cursor }).value.events, []);
  assert.ok(session.takeEvents('a').value.length);
  assert.deepEqual(session.takeEvents('a').value, []);
  assert.ok(session.takeEvents('b').value.length);
  session.dispose();
  assert.equal(a.events().ok, false);
});
test('private sandbox add only exposes card identity to the receiving viewer', () => {
  const session = match('sandbox');
  const a = session.port('a').value, b = session.port('b').value;
  const control = session.sandboxControl('a').value;
  const added = control.submit({ commandId: 'add', expectedRevision: 0,
    action: { type: 'sandboxAddCard', definitionId: 'STD-075', targetSeat: 'a' } });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.doesNotMatch(JSON.stringify(b.events().value.events), /STD-075|ジャンキー/);
  assert.doesNotMatch(JSON.stringify(a.events().value.events), /"uid"/);
});
test('cursor getters are rejected without evaluation', () => {
  const port = match().port('a').value;
  let called = false;
  const result = port.events({ get afterEventId() { called = true; return null; } });
  assert.equal(called, false);
  assert.equal(result.ok, false);
});
test('real port attacks publish actual user and simultaneous combat numbers, not parsed log text', () => {
  const session = match('ai', { playerDeckRecipe: [['STD-020', 40]], aiDeckRecipe: [['STD-020', 40]] });
  const a = session.port('a').value, b = session.port('b').value;
  const play = (port, seatIndex, id) => {
    const card = port.query().value.observation.seats[seatIndex].hand.cards[0];
    const result = submit(port, { type: 'executeCard', cardRef: card.cardRef,
      destination: { zone: 'front', slot: 1 } }, id);
    assert.equal(result.value.kind, 'accepted');
  };
  play(a, 0, 'play-a');
  submit(a, { type: 'endTurn' }, 'end-a');
  play(b, 1, 'play-b');
  submit(b, { type: 'endTurn' }, 'end-b');
  let query = a.query().value;
  const first = query.observation.seats[0].front.cards[0];
  const str = query.observation.seats[1].fortressStr;
  submit(a, { type: 'attack', attackerRef: first.cardRef,
    target: { kind: 'user', seatId: 'b' } }, 'direct');
  const user = a.events().value.events.find(event => event.type === 'user_damaged');
  assert.ok(user);
  assert.equal(user.actorSeat, 'a');
  assert.equal(user.target.seatId, 'b');
  assert.equal(user.before, str);
  assert.equal(user.after, a.query().value.observation.seats[1].fortressStr);
  assert.equal(user.source.definitionId, 'STD-020');
  submit(a, { type: 'endTurn' }, 'end-a-2');
  query = b.query().value;
  const source = query.observation.seats[1].front.cards[0];
  const target = query.observation.seats[0].front.cards[0];
  submit(b, { type: 'attack', attackerRef: source.cardRef,
    target: { kind: 'card', cardRef: target.cardRef } }, 'combat');
  const combat = b.events().value.events.find(event => event.type === 'combat_resolved');
  assert.ok(combat);
  assert.equal(combat.sourceStrBefore, source.computed.currentStr);
  assert.equal(combat.targetStrBefore, target.computed.currentStr);
  assert.equal(combat.damage, source.computed.currentAtk);
  assert.equal(combat.counterDamage, target.computed.currentAtk);
  assert.doesNotMatch(JSON.stringify(combat), /"(?:uid|cardUid|targetUid|playerId)"/);
});
