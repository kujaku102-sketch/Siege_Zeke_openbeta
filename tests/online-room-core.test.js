import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, fakeEngine, memoryStore, startedRoom, acceptAnyDeck, START_DECK } from './online-test-kit.js';
import { LIMITS } from '../src/network/protocol.js';

const cmd = (commandId, expectedRevision, action = { type: 'go' }) => ({ t: 'cmd', commandId, expectedRevision, action });
const winnerOf = (harness, a, b) => harness.room().game.seatIds[0] === a.seat ? { winner: a, loser: b } : { winner: b, loser: a };

test('a room is made once; guests join in order; the second guest turns it into a lobby', async () => {
  const harness = createHarness();
  const a = harness.client('ゆうき'), b = harness.client('  Taro\u0000  ');
  await a.open();
  assert.equal(a.last('error').code, 'ROOM_NOT_FOUND', 'no room yet');
  assert.equal(a.closed.code, 4004);
  assert.deepEqual(await harness.core.init({ code: 'ABCD2345' }), { ok: true });
  assert.equal((await harness.core.init({ code: 'ABCD2345' })).error.code, 'ROOM_EXISTS');
  const c = harness.client('first');
  await c.open(); await c.hello();
  const welcome = c.last('welcome');
  assert.equal(welcome.phase, 'waiting');
  assert.equal(welcome.you.slot, 0);
  assert.equal(welcome.opponent, null);
  assert.ok(welcome.expiresInMs > 0 && welcome.expiresInMs <= LIMITS.waitingMs);
  await b.open(); await b.hello();
  assert.equal(b.last('welcome').phase, 'lobby');
  assert.equal(b.last('welcome').you.name, 'Taro', 'control characters are removed');
  assert.equal(b.last('welcome').opponent.name, 'first');
  assert.equal(c.last('lobby').opponent.name, 'Taro', 'the first guest hears about the second');
});

test('nothing but hello is accepted from a connection that has not said hello', async () => {
  const harness = createHarness({ withHelloTimer: true });
  await harness.core.init({ code: 'ABCD2345' });
  const early = harness.client();
  await early.open();
  await early.send({ t: 'ready', userId: 'doors_zx', deck: START_DECK });
  assert.equal(early.last('error').code, 'HELLO_REQUIRED');
  assert.equal(early.closed.code, 4002);
  const garbage = harness.client();
  await garbage.open();
  await garbage.raw('{broken');
  assert.equal(garbage.last('error').code, 'BAD_MESSAGE');
  assert.equal(garbage.closed.code, 4002);
  const silent = harness.client();
  await silent.open();
  await harness.advance(LIMITS.helloMs - 1);
  assert.equal(silent.closed, null);
  await harness.advance(1);
  assert.equal(silent.closed.code, 4001, 'a connection that never says hello is closed');
  const polite = harness.client();
  await polite.open(); await polite.hello();
  await harness.advance(LIMITS.helloMs * 2);
  assert.equal(polite.closed, null, 'saying hello cancels the wait');
  const twice = await polite.hello();
  assert.equal(twice.last('error').code, 'ALREADY_HELLO');
});

test('the match starts when both guests are ready, with random seats and each guest on their own deck', async () => {
  const harness = createHarness({ checkDeck: ({ userId, deck }) => deck.deckId === 'bad' ? { ok: false, error: { code: 'DECK_START_UNKNOWN' } } : acceptAnyDeck({ userId, deck }) });
  await harness.core.init({ code: 'ABCD2345' });
  const a = harness.client('A'), b = harness.client('B');
  await a.join(); await b.join();
  await a.ready('doors_zx', { kind: 'start', deckId: 'bad' });
  assert.equal(a.last('error').code, 'DECK_INVALID');
  assert.equal(a.last('error').detail.code, 'DECK_START_UNKNOWN');
  await a.ready('userA', { kind: 'start', deckId: 'deck-a' });
  assert.equal(b.last('lobby').opponent.ready, true);
  assert.equal(b.last('lobby').opponent.userId, 'userA');
  assert.equal(a.last('start'), undefined, 'one ready guest does not start it');
  await b.ready('userB', { kind: 'start', deckId: 'deck-b' });
  const room = harness.room();
  assert.equal(room.phase, 'playing');
  const [startA, startB] = [a.last('start'), b.last('start')];
  assert.notEqual(startA.you.seat, startB.you.seat);
  assert.equal(startA.matchId, startB.matchId);
  assert.match(startA.matchId, /^ol-[\w-]+$/);
  const players = room.game.players;
  const seatA = room.game.seatIds.indexOf(startA.you.seat);
  assert.equal(players[seatA].userId, 'userA', 'players[i] sits at seatIds[i]');
  assert.equal(players[1 - seatA].userId, 'userB');
  assert.equal(a.last('state').revision, 0);
  assert.deepEqual(Object.keys(a.last('state')).sort(), ['actionBlocks', 'events', 'legalActions', 'observation', 'requiredInput', 'revision', 'status', 't', 'v']);
  // Which guest gets seatIds[0] is a coin flip.
  const firsts = new Set();
  for (let index = 0; index < 40; index += 1) {
    const { harness: other, a: x } = await startedRoom();
    firsts.add(other.room().game.seatIds[0] === x.seat);
  }
  assert.equal(firsts.size, 2, 'both orders happen');
});

test('a third guest cannot take a seat, and a lost seat comes back only with its own token', async () => {
  const { harness, a, b } = await startedRoom();
  const third = harness.client('C');
  await third.open(); await third.hello();
  assert.equal(third.last('error').code, 'ROOM_FULL');
  assert.equal(third.closed.code, 4003);
  const lobbyThird = createHarness();
  await lobbyThird.core.init({ code: 'ABCD2345' });
  await lobbyThird.client().join(); await lobbyThird.client().join();
  const late = lobbyThird.client();
  await late.open(); await late.hello();
  assert.equal(late.closed.code, 4003, 'a full lobby is closed to a third guest too');
  // A new connection with the same token takes over the seat; the old one is closed.
  const again = harness.client('A');
  again.token = a.token;
  await again.open(); await again.hello();
  assert.equal(a.closed.code, 4009);
  assert.equal(again.last('welcome').you.seat, a.seat);
  assert.equal(again.last('state').revision, 0);
  // A different token that knows nothing about the seat gets nothing.
  const thief = harness.client('thief');
  await thief.open(); await thief.hello();
  assert.equal(thief.closed.code, 4003);
  assert.equal(b.closed, null);
});

test('a command is judged by the engine for the connection\'s own seat, saved, and shown to both guests', async () => {
  const seen = [];
  const engine = fakeEngine();
  const submit = engine.submit;
  engine.submit = (authority, seatId, intent) => { seen.push([seatId, intent.commandId]); return submit(authority, seatId, intent); };
  const { harness, a, b } = await startedRoom({ engine });
  await a.send(cmd('c1', 0));
  assert.deepEqual(seen, [[a.seat, 'c1']]);
  assert.equal(a.last('ack').kind, 'accepted');
  assert.equal(a.last('state').revision, 1);
  assert.equal(b.last('state').revision, 1);
  assert.deepEqual(a.last('state').events, [{ eventId: 'e1', viewer: a.seat }], 'each seat gets its own events');
  assert.deepEqual(b.last('state').events, [{ eventId: 'e1', viewer: b.seat }]);
  assert.equal(b.last('ack'), undefined, 'only the sender gets the ack');
  assert.equal(JSON.parse(harness.store.get('authority')).revision, 1);
  assert.deepEqual(harness.store.list('cmd:'), [{ seat: a.seat, action: { type: 'go' } }]);
  // A seat claim inside the message is not part of the contract.
  await b.raw(JSON.stringify({ v: 1, t: 'cmd', commandId: 'c2', expectedRevision: 1, action: { type: 'go' }, actorSeat: a.seat }));
  assert.equal(b.last('error').code, 'BAD_MESSAGE');
  assert.equal(seen.length, 1);
});

test('a stale revision is rejected without a new state; a repeated command id gets the first answer back', async () => {
  const { harness, a, b } = await startedRoom();
  await a.send(cmd('c1', 0));
  const statesBefore = b.all('state').length;
  await b.send(cmd('c2', 0));
  assert.equal(b.last('ack').kind, 'rejected');
  assert.equal(b.last('ack').receipt.reasonCode, 'STALE_REVISION');
  assert.equal(b.all('state').length, statesBefore, 'a rejection changes nothing for anyone');
  assert.equal(JSON.parse(harness.store.get('authority')).seen.includes('c2'), true, 'the rejection is remembered for the retry check');
  assert.equal(harness.store.list('cmd:').length, 1, 'only accepted commands are kept as moves');
  await a.send(cmd('c1', 0));
  assert.equal(a.last('ack').kind, 'retry');
  assert.equal(a.last('state').revision, 1, 'the sender is brought up to date');
  assert.equal(b.all('state').length, statesBefore, 'the other seat hears nothing');
  assert.equal(harness.store.list('cmd:').length, 1);
});

test('commands, plans and inspections need a running match', async () => {
  const harness = createHarness();
  await harness.core.init({ code: 'ABCD2345' });
  const a = harness.client(); await a.join();
  await a.send(cmd('c1', 0));
  assert.equal(a.last('error').code, 'NOT_PLAYING');
  await a.send({ t: 'plan', rid: 'p1', expectedRevision: 0, actionId: 'action:0:1', selections: [] });
  assert.equal(a.last('error').code, 'NOT_PLAYING');
  await a.send({ t: 'concede', commandId: 'x' });
  assert.equal(a.last('error').code, 'NOT_PLAYING');
  const b = harness.client(); await b.join();
  await a.ready(); await b.ready();
  await a.send({ t: 'plan', rid: 'p2', expectedRevision: 0, actionId: 'action:0:1', selections: [] });
  assert.deepEqual(a.last('planResult'), { v: 1, t: 'planResult', rid: 'p2', result: { seatId: a.seat, input: { expectedRevision: 0, actionId: 'action:0:1', selections: [] } } });
  await a.send({ t: 'inspect', rid: 'i1', ref: `r:${'a'.repeat(32)}` });
  assert.equal(a.last('inspectResult').error.code, 'INSPECTION_NOT_ALLOWED');
  await a.send({ t: 'ready', userId: 'doors_zx', deck: START_DECK });
  assert.equal(a.last('error').code, 'WRONG_PHASE', 'decks are fixed once the match runs');
});

test('the match ends when the engine says so, each guest hears their own result, and the room goes away later', async () => {
  const { harness, a, b } = await startedRoom();
  await a.send(cmd('c1', 0)); await b.send(cmd('c2', 1)); await a.send(cmd('c3', 2));
  const { winner, loser } = winnerOf(harness, a, b);
  assert.equal(winner.last('end').outcome, 'win');
  assert.equal(loser.last('end').outcome, 'lose');
  assert.equal(winner.last('end').reason, 'normal');
  assert.equal(winner.last('end').record.revision, 3);
  assert.equal(winner.last('end').record.commands.length, 3);
  assert.equal(harness.finished.length, 1);
  assert.equal(harness.room().phase, 'finished');
  await a.send(cmd('c4', 3));
  assert.equal(a.last('error').code, 'NOT_PLAYING');
  // The result stays readable for a while.
  const back = harness.client('A'); back.token = loser.token;
  await back.open(); await back.hello();
  assert.equal(back.last('end').outcome, 'lose');
  await harness.advance(LIMITS.finishedKeepMs - 1);
  assert.notEqual(harness.room(), null);
  await harness.advance(1);
  assert.equal(harness.room(), null);
  assert.equal(harness.store.map.size, 0, 'everything the room stored is deleted');
  assert.equal(harness.alarmAt(), null);
  assert.equal(back.last('error').code, 'ROOM_CLOSED');
});

test('a connection that talks too much or sends too much is slowed, then cut off', async () => {
  const { a } = await startedRoom();
  for (let index = 0; index < LIMITS.rateBurst + 10; index += 1) await a.send({ t: 'resync' });
  assert.equal(a.all('error').filter(frame => frame.code === 'RATE_LIMITED').length, 3, 'three warnings, then the connection is closed');
  assert.equal(a.closed.code, 1008);
  const harness = createHarness();
  await harness.core.init({ code: 'ABCD2345' });
  const big = harness.client(); await big.open();
  await big.raw('x'.repeat(LIMITS.maxMessageBytes + 1));
  assert.equal(big.last('error').code, 'MESSAGE_TOO_LARGE');
  assert.equal(big.closed.code, 1009);
});

test('the allowance refills with time', async () => {
  const { harness, a } = await startedRoom();
  while (a.all('error').length === 0) await a.send({ t: 'resync' });
  assert.equal(a.last('error').code, 'RATE_LIMITED');
  await harness.advance(1000);
  const warnings = a.all('error').length;
  await a.send({ t: 'resync' });
  assert.equal(a.all('error').length, warnings, 'a message after a pause is answered, not refused');
  assert.equal(a.closed, null);
});

test('a dropped guest has 60 seconds; coming back in time cancels the loss', async () => {
  const { harness, a, b } = await startedRoom();
  await a.drop();
  assert.equal(b.last('peer').connected, false);
  assert.equal(b.last('peer').graceMs, LIMITS.graceMs);
  assert.equal(harness.alarmAt(), harness.now() + LIMITS.graceMs);
  await harness.advance(LIMITS.graceMs - 1000);
  assert.equal(harness.room().phase, 'playing');
  assert.equal(b.last('peer').connected, false);
  const back = harness.client('A'); back.token = a.token;
  await back.open(); await back.hello();
  assert.equal(b.last('peer').connected, true);
  assert.equal(back.last('state').revision, 0, 'the returning guest gets the current state');
  await harness.advance(LIMITS.graceMs * 3);
  assert.equal(harness.room().phase, 'playing');
  assert.equal(harness.finished.length, 0);
});

test('a guest who stays away loses when the 60 seconds are up, and sees it on return', async () => {
  const { harness, a, b } = await startedRoom();
  await a.drop();
  await harness.advance(LIMITS.graceMs);
  assert.equal(harness.room().phase, 'finished');
  assert.equal(b.last('end').outcome, 'win');
  assert.equal(b.last('end').reason, 'disconnect');
  assert.equal(harness.finished.length, 1);
  const back = harness.client('A'); back.token = a.token;
  await back.open(); await back.hello();
  assert.equal(back.last('end').outcome, 'lose');
});

test('when both are away nobody loses at the first deadline; if neither returns the match is aborted', async () => {
  const { harness, a, b } = await startedRoom();
  await a.drop();
  await harness.advance(30000);
  await b.drop();
  assert.equal(harness.alarmAt(), harness.now() - 30000 + LIMITS.graceMs, 'the first deadline');
  await harness.advance(30000);
  assert.equal(harness.room().phase, 'playing', 'the first guest is out of time but the second still has theirs');
  assert.equal(harness.alarmAt(), harness.now() + 30000, 'the next wake is the second deadline');
  await harness.advance(30000);
  assert.equal(harness.room().phase, 'finished');
  assert.equal(harness.room().outcome.kind, 'aborted');
  assert.equal(harness.room().outcome.reason, 'both-disconnected');
  const back = harness.client('B'); back.token = b.token;
  await back.open(); await back.hello();
  assert.equal(back.last('end').outcome, 'aborted');
});

test('if the first guest returns while the second is away, the second is the one who can lose', async () => {
  const { harness, a, b } = await startedRoom();
  await a.drop();
  await harness.advance(20000);
  await b.drop();
  await harness.advance(10000);
  const back = harness.client('A'); back.token = a.token;
  await back.open(); await back.hello();
  assert.equal(harness.room().phase, 'playing');
  await harness.advance(LIMITS.graceMs);
  assert.equal(harness.room().phase, 'finished');
  assert.equal(back.last('end').outcome, 'win');
  assert.equal(back.last('end').reason, 'disconnect');
});

test('conceding ends the match at once; an engine that can forfeit decides the result itself', async () => {
  const { harness, a, b } = await startedRoom();
  await a.send({ t: 'concede', commandId: 'q1' });
  assert.equal(a.last('end').outcome, 'lose');
  assert.equal(b.last('end').outcome, 'win');
  assert.equal(b.last('end').reason, 'concede');

  const engine = fakeEngine();
  const calls = [];
  engine.forfeit = (authority, seatId, why) => {
    calls.push([seatId, why.reason]);
    const next = { ...authority, revision: authority.revision + 1, forfeited: seatId };
    return { ok: true, authority: next, revision: next.revision, eventsFor: viewer => [{ eventId: 'forfeit', viewer }] };
  };
  const other = await startedRoom({ engine });
  await other.b.send({ t: 'concede', commandId: 'q2' });
  assert.deepEqual(calls, [[other.b.seat, 'concede']]);
  assert.equal(other.a.last('state').events[0].eventId, 'forfeit', 'both seats see the forfeit as an event');
  assert.equal(JSON.parse(other.harness.store.get('authority')).forfeited, other.b.seat);
  assert.equal(other.a.last('end').outcome, 'win');
  assert.equal(other.b.last('end').outcome, 'lose');
  assert.deepEqual(other.harness.store.list('cmd:').at(-1), { seat: other.b.seat, system: 'forfeit', reason: 'concede' });
});

test('a room nobody joins expires, and so does a lobby that goes quiet', async () => {
  const harness = createHarness();
  await harness.core.init({ code: 'ABCD2345' });
  const a = harness.client('A'); await a.join();
  assert.equal(harness.alarmAt(), harness.now() + LIMITS.waitingMs);
  await harness.advance(LIMITS.waitingMs - 1);
  assert.notEqual(harness.room(), null);
  await harness.advance(1);
  assert.equal(harness.room(), null);
  assert.equal(a.last('error').code, 'ROOM_CLOSED');
  assert.equal(a.closed.code, 4004);
  assert.equal(harness.store.map.size, 0);

  const lobby = createHarness();
  await lobby.core.init({ code: 'ABCD2345' });
  const x = lobby.client(), y = lobby.client();
  await x.join(); await y.join();
  await lobby.advance(LIMITS.lobbyIdleMs - 1000);
  await x.ready();
  await lobby.advance(LIMITS.lobbyIdleMs - 1000);
  assert.notEqual(lobby.room(), null, 'a deck choice counts as activity');
  await lobby.advance(1000);
  assert.equal(lobby.room(), null);
});

test('a running match is stopped after six hours', async () => {
  const { harness, a } = await startedRoom();
  await harness.advance(LIMITS.maxRoomAgeMs);
  assert.equal(harness.room().phase, 'finished');
  assert.equal(harness.room().outcome.reason, 'max-age');
  assert.equal(a.last('end').outcome, 'aborted');
});

test('leaving a lobby frees the seat; the last guest leaving closes the room', async () => {
  const harness = createHarness();
  await harness.core.init({ code: 'ABCD2345' });
  const a = harness.client('A'), b = harness.client('B');
  await a.join(); await b.join();
  await a.ready();
  await b.send({ t: 'bye' });
  assert.equal(b.closed.code, 1000);
  assert.equal(harness.room().phase, 'waiting');
  assert.equal(a.last('lobby').opponent, null);
  assert.equal(harness.room().seats[0].ready, false, 'ready marks are cleared when the lobby changes');
  const c = harness.client('C'); await c.join();
  assert.equal(c.last('welcome').phase, 'lobby');
  await a.send({ t: 'bye' }); await c.send({ t: 'bye' });
  assert.equal(harness.room(), null);
});

test('a room woken in a new process carries on from what it stored', async () => {
  const store = memoryStore();
  const first = await startedRoom({ store });
  await first.a.send(cmd('c1', 0)); await first.b.send(cmd('c2', 1));
  const second = createHarness({ store, at: first.harness.now() + 5000 });
  const a = second.client('A'); a.token = first.a.token;
  await a.open(); await a.hello();
  assert.equal(a.last('welcome').phase, 'playing');
  assert.equal(a.last('state').revision, 2);
  assert.equal(a.last('welcome').you.seat, first.a.seat);
  await a.send(cmd('c3', 2));
  const { winner } = winnerOf(second, { seat: first.a.seat }, { seat: first.b.seat });
  assert.equal(second.finished.length, 1);
  assert.equal(second.room().phase, 'finished');
  assert.equal(a.last('end').outcome, winner.seat === first.a.seat ? 'win' : 'lose');
  assert.equal(first.harness.room().phase, 'playing', 'the earlier process had its own copy in memory');
});

test('a socket that was already known to the room is registered again after the host forgot its memory', async () => {
  const store = memoryStore();
  const first = await startedRoom({ store });
  const second = createHarness({ store, at: first.harness.now() + 1000 });
  const { sha256Hex } = await import('../src/network/room-code.js');
  const woken = second.client('A');
  await second.core.restore(woken.connId, await sha256Hex(first.a.token));
  await woken.send(cmd('c1', 0));
  assert.equal(woken.last('ack').kind, 'accepted');
  assert.equal(woken.last('state').revision, 1);
});

test('a storage failure ends the match without moving the state on', async () => {
  const store = memoryStore();
  const { harness, a, b } = await startedRoom({ store });
  const put = store.put;
  store.put = (key, value) => { if (key === 'authority') throw new Error('quota'); return put(key, value); };
  await a.send(cmd('c1', 0));
  assert.equal(a.last('error').code, 'STORAGE_UNAVAILABLE');
  assert.equal(b.last('error').code, 'STORAGE_UNAVAILABLE');
  assert.equal(b.last('end').outcome, 'aborted');
  assert.equal(b.last('end').reason, 'storage');
  assert.equal(a.all('state').length, 1, 'no state for a command that was not saved');
  assert.equal(JSON.parse(harness.store.get('authority')).revision, 0, 'the saved state did not move');
});

test('after a process restart every seat of a running match gets its 60 seconds again', async () => {
  const store = memoryStore();
  const first = await startedRoom({ store });
  await first.a.drop();
  await first.harness.advance(50000); // A had 10 seconds left when the process stopped
  const second = createHarness({ store, at: first.harness.now() + 120000 }); // and the process was down for two minutes
  await second.core.startup();
  const room = second.room();
  assert.equal(room.phase, 'playing');
  assert.ok(room.seats.every(seat => seat.disconnectedAt === second.now()), 'both seats start over from the restart');
  assert.equal(second.alarmAt(), second.now() + LIMITS.graceMs);
  const back = second.client('B'); back.token = first.b.token;
  await back.open(); await back.hello();
  await second.advance(LIMITS.graceMs);
  assert.equal(second.room().phase, 'finished', 'A never came back, B did');
  assert.equal(back.last('end').outcome, 'win');
  assert.equal(back.last('end').reason, 'disconnect');
  // A room that is not running is left alone.
  const lobby = createHarness();
  await lobby.core.init({ code: 'ABCD2345' });
  await lobby.core.startup();
  assert.equal(lobby.room().seats.length, 0);
});
