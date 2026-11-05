// A room driven through its wire messages with the real runtime behind it (Node only; the Worker build is a later step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './online-test-kit.js';
import { createRuntimeEngine } from '../src/network/runtime-engine.js';
import { checkDeckChoice } from '../src/network/deck-check.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { replayMatchRecord } from '../src/adapters/match-replay.js';

const engine = createRuntimeEngine();
const CARD_REF = /r:[0-9a-f]{32}/g;

async function openRoom(decks = ['start-red', 'start-yellow']) {
  const harness = createHarness({ engine, checkDeck: checkDeckChoice });
  await harness.core.init({ code: 'ABCD2345' });
  const a = harness.client('A'), b = harness.client('B');
  await a.join(); await b.join();
  await a.ready('doors_zx', { kind: 'start', deckId: decks[0] });
  await b.ready('doors_zx', { kind: 'start', deckId: decks[1] });
  return { harness, a, b };
}

// Both guests play the simple CPU policy through the wire until the match ends, the policy has nothing to offer, or the step budget is spent.
async function playThrough(harness, a, b, steps = 400) {
  let serial = 0, played = 0;
  for (; played < steps && harness.room().phase === 'playing'; played += 1) {
    const [qa, qb] = [a.last('state'), b.last('state')];
    const actor = qa.requiredInput?.canAnswer ? a : qb.requiredInput?.canAnswer ? b : qa.status.activeSeat === a.seat ? a : b;
    const mirror = engine.restore(harness.store.get('authority')).value;
    const intent = chooseSimpleAiIntent(actor.last('state'), `cpu:${++serial}`, input => engine.plan(mirror, actor.seat, input));
    if (!intent.ok) return { played, stalled: true };
    const before = actor.frames.length;
    await actor.send({ t: 'cmd', ...intent.value });
    const fresh = actor.frames.slice(before);
    if (fresh.some(frame => frame.t === 'error') || fresh.find(frame => frame.t === 'ack')?.receipt.status !== 'accepted') return { played, stalled: true, frames: fresh };
    await harness.advance(1500); // a person takes a moment between moves, which also refills the rate allowance
  }
  return { played, stalled: false };
}

const transcript = client => client.frames.map(frame => JSON.stringify(frame)).join('\n');

test('what each guest receives never carries the other guest\'s cards, tokens or card references', async () => {
  const { harness, a, b } = await openRoom();
  const result = await playThrough(harness, a, b, 40);
  assert.ok(result.played >= 10, `only ${result.played} commands were played`);
  for (const [me, other] of [[a, b], [b, a]]) {
    for (const frame of me.all('state')) {
      const opponent = frame.observation.seats.find(seat => seat.seatId === other.seat);
      assert.deepEqual(Object.keys(opponent.hand), ['count'], 'the opponent\'s hand is a number');
      assert.deepEqual(Object.keys(opponent.deck), ['count'], 'the opponent\'s deck is a number');
      assert.equal(frame.status.viewerSeat, me.seat);
    }
    const mine = new Set(transcript(me).match(CARD_REF));
    const theirs = new Set(transcript(other).match(CARD_REF));
    assert.ok(mine.size > 0 && theirs.size > 0);
    assert.deepEqual([...mine].filter(ref => theirs.has(ref)), [], 'card references are different for each seat');
    assert.equal(transcript(me).includes(other.token), false, 'the other guest\'s token never travels');
    assert.equal(transcript(me).includes(me.token), false, 'not even the guest\'s own token comes back');
    assert.equal(/hash/i.test(Object.keys(JSON.parse(transcript(me).split('\n')[0])).join()), false);
  }
  assert.equal(JSON.stringify(harness.room().seats.map(seat => seat.hash)).includes(a.token), false, 'only hashes are kept');
});

test('the opening: only the seat that is up may act, and a repeat or a clash is handled by the runtime', async () => {
  const { harness, a, b } = await openRoom();
  const state = a.last('state');
  const [active, idle] = state.status.activeSeat === a.seat ? [a, b] : [b, a];
  const keep = { type: 'keepOpeningHand' };
  await idle.send({ t: 'cmd', commandId: 'x1', expectedRevision: 0, action: keep });
  assert.equal(idle.last('ack').receipt.status, 'rejected');
  assert.equal(idle.last('ack').receipt.reasonCode, 'ACTION_NOT_ALLOWED');
  assert.equal(harness.room().phase, 'playing');

  await active.send({ t: 'cmd', commandId: 'k1', expectedRevision: 0, action: keep });
  assert.equal(active.last('ack').kind, 'accepted');
  const revision = active.last('state').revision;
  assert.ok(revision >= 1);
  const states = idle.all('state').length;
  await active.send({ t: 'cmd', commandId: 'k1', expectedRevision: 0, action: keep });
  assert.equal(active.last('ack').kind, 'retry', 'the same command again is answered, not applied twice');
  assert.equal(active.last('state').revision, revision);
  assert.equal(idle.all('state').length, states, 'the other seat hears nothing of a repeat');
  await active.send({ t: 'cmd', commandId: 'k1', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(active.last('error').code, 'COMMAND_ID_COLLISION', 'same id, different command');
  assert.equal(active.last('error').commandId, 'k1');
  assert.equal(active.last('state').revision, revision);
  await active.send({ t: 'cmd', commandId: 'k2', expectedRevision: 0, action: keep });
  assert.equal(active.last('ack').receipt.reasonCode, 'STALE_REVISION');
});

test('planning questions are answered for the asking seat only, and a stale one is refused', async () => {
  const { a, b } = await openRoom();
  const state = a.last('state');
  const [active, idle] = state.status.activeSeat === a.seat ? [a, b] : [b, a];
  const entry = active.last('state').legalActions.find(item => item.actionType === 'openingMulligan');
  assert.ok(entry, 'the seat that is up can ask for a redraw');
  await active.send({ t: 'plan', rid: 'p1', expectedRevision: 0, actionId: entry.actionId, selections: [] });
  const plan = active.last('planResult');
  assert.equal(plan.rid, 'p1');
  assert.equal(plan.result.selectionRequests.length, 1);
  assert.equal(plan.result.viewerSeat, active.seat);
  await idle.send({ t: 'plan', rid: 'p2', expectedRevision: 0, actionId: entry.actionId, selections: [] });
  assert.equal(idle.last('planResult').error.code, 'ACTION_NOT_ALLOWED', 'the other seat has no such action');
  await active.send({ t: 'plan', rid: 'p3', expectedRevision: 7, actionId: entry.actionId, selections: [] });
  assert.equal(active.last('planResult').error.code, 'STALE_REVISION');
});

test('a guest who drops and returns picks up the same match, with the log either kept or rebuilt', async () => {
  const { harness, a, b } = await openRoom();
  const played = await playThrough(harness, a, b, 14);
  assert.ok(played.played >= 8, `${played.played} commands`);
  const live = a.all('state').flatMap(frame => frame.events).map(event => event.type);
  assert.ok(live.length > 5);
  const revision = a.last('state').revision;
  await a.drop();
  assert.equal(b.last('peer').connected, false);
  await harness.advance(20000);

  const kept = harness.client('A'); kept.token = a.token;
  await kept.open(); await kept.hello({ haveRevision: revision });
  assert.equal(kept.last('state').revision, revision);
  assert.deepEqual(kept.last('state').events, [], 'a page that still has its log needs no history');
  assert.equal(b.last('peer').connected, true);
  assert.equal(JSON.stringify(kept.last('state').observation.seats.find(seat => seat.seatId === a.seat).hand.count), JSON.stringify(a.last('state').observation.seats.find(seat => seat.seatId === a.seat).hand.count));

  const reloaded = harness.client('A'); reloaded.token = a.token;
  await reloaded.open(); await reloaded.hello();
  assert.equal(kept.closed.code, 4009, 'the earlier connection of this seat is replaced');
  assert.equal(reloaded.last('state').revision, revision);
  const rebuilt = reloaded.last('state').events.map(event => event.type);
  assert.deepEqual(rebuilt, live, 'a reloaded page gets the whole feed again, in the same order');
  await b.send({ t: 'resync' });
  assert.equal(b.last('state').revision, revision);
});

test('conceding ends a real match, and the record it sends replays', async () => {
  const { harness, a, b } = await openRoom();
  await playThrough(harness, a, b, 12);
  await b.send({ t: 'concede', commandId: 'give-up' });
  assert.equal(harness.room().phase, 'finished');
  assert.equal(a.last('end').outcome, 'win');
  assert.equal(b.last('end').outcome, 'lose');
  assert.equal(a.last('end').reason, 'concede');
  const record = a.last('end').record;
  assert.equal(record.kind, 'siege-zeke.replay');
  assert.equal(record.game.matchId, harness.room().game.matchId);
  assert.ok(record.commands.length >= 8);
  const replayed = replayMatchRecord(JSON.parse(JSON.stringify(record)));
  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  assert.equal(replayed.value.revision, a.all('state').at(-1).revision, 'the record plays back to the state the guests saw');
  assert.equal(JSON.stringify(record).includes(a.token), false);
  assert.deepEqual(record.commands.at(-1).action, { type: 'concede' }, 'a concession is an ordinary command in the record');
  assert.equal(replayed.value.engineState.victory.finished, true, 'and it plays back to a finished match');
  assert.ok(a.all('state').at(-1).events.some(event => event.type === 'result_finished'), 'the runtime itself ended the match');
});

test('a lost connection ends a real match through the server-only entry, and its record replays', async () => {
  const { harness, a, b } = await openRoom();
  await playThrough(harness, a, b, 12);
  await a.drop();
  await harness.advance(60000);
  assert.equal(harness.room().phase, 'finished');
  assert.equal(b.last('end').outcome, 'win');
  assert.equal(b.last('end').reason, 'disconnect');
  const record = b.last('end').record;
  assert.equal(record.commands.at(-1).seat, a.seat);
  assert.deepEqual(record.commands.at(-1).action, { type: 'systemForfeit', reason: 'disconnect' });
  assert.ok(b.all('state').at(-1).events.some(event => event.type === 'result_finished'));
  const replayed = replayMatchRecord(JSON.parse(JSON.stringify(record)));
  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  assert.equal(replayed.value.engineState.victory.finished, true);
  // The client cannot send the server's entry.
  const other = await openRoom();
  await other.a.send({ t: 'cmd', commandId: 'x1', expectedRevision: 0, action: { type: 'systemForfeit', reason: 'disconnect' } });
  assert.notEqual(other.a.last('ack')?.kind, 'accepted');
  assert.equal(other.harness.room().phase, 'playing');
});

test('a match played to its natural end gives each guest their own result and a record that replays', async () => {
  // The simple CPU policy sometimes cannot answer a pending choice, so a few rooms are tried.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { harness, a, b } = await openRoom(attempt % 2 ? ['start-yellow', 'start-red'] : ['start-red', 'start-yellow']);
    const result = await playThrough(harness, a, b, 400);
    if (result.stalled || harness.room().phase !== 'finished') continue;
    const outcomes = [a.last('end').outcome, b.last('end').outcome].sort();
    assert.ok(['lose,win', 'draw,draw'].includes(outcomes.join()), outcomes.join());
    assert.equal(a.last('end').reason, 'normal');
    const record = a.last('end').record;
    assert.equal(record.summary.finished, true);
    const replayed = replayMatchRecord(JSON.parse(JSON.stringify(record)));
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(harness.finished.length, 1);
    return;
  }
  assert.fail('no room reached its natural end in six tries');
});
