import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { replayMatchRecord } from '../src/adapters/match-replay.js';
import { createLocalRuntimeCoordinator } from '../src/adapters/local-runtime-port.js';

const runtimeConfig = (mode, matchId) => ({ matchId, seatIds: ['player', 'ai'], seed: 4242, ruleVersion: '2.0', cardVersion: 'public',
  gameOptions: { mode, playerDeckId: 'red', aiDeckId: 'yellow', playerUserId: 'doors_zx', aiUserId: 'doors_zx',
    sandboxDeckSetup: mode === 'sandbox' } });

// Both seats play the simple CPU policy until the match ends or the step budget runs out.
function playOut(session, steps) {
  let serial = 0;
  for (let step = 0; step < steps; step++) {
    let port = session.port('player').value, query = port.query().value;
    if (query.status.finished) return;
    if (query.requiredInput ? !query.requiredInput.canAnswer : query.status.activeSeat !== 'player') {
      port = session.port('ai').value; query = port.query().value;
    }
    const intent = chooseSimpleAiIntent(query, `cpu:${++serial}`, input => port.queryAction(input));
    if (!intent.ok) return;
    assert.equal(port.submit(intent.value).ok, true);
  }
}

// The engine's own log ids carry wall-clock time; everything else must match.
const comparable = state => JSON.parse(JSON.stringify({ ...state, log: state.log.map(({ id, ...entry }) => entry) }));

test('a recorded CPU match replays to the same engine state', () => {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('ai', 'record-ai') });
  assert.equal(made.ok, true, JSON.stringify(made));
  const session = made.value;
  try {
    playOut(session, 400);
    const record = session.matchRecord();
    assert.equal(record.ok, true, JSON.stringify(record));
    const { commands, summary, game } = record.value;
    assert.ok(commands.length > 20, `only ${commands.length} commands`);
    assert.equal(game.seed, 4242);
    assert.equal(summary.mode, 'ai');
    assert.equal(summary.commandCount, commands.length);
    assert.ok(Object.values(summary.cardsUsed.player).reduce((sum, count) => sum + count, 0) > 0);
    assert.equal(JSON.stringify(commands).includes('r:'), false, 'session refs never reach the record');

    const replayed = replayMatchRecord(JSON.parse(JSON.stringify(record.value)));
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    const live = session.port('player').value.query().value;
    assert.equal(replayed.value.revision, live.status.revision);
    assert.equal(replayed.value.engineState.turnNumber, summary.turns);
    // The live authority is private to the session, so compare through a second replay as well.
    const again = replayMatchRecord(record.value);
    assert.deepEqual(comparable(again.value.engineState), comparable(replayed.value.engineState));
    // Each seat sees the same board in the replay as in the live match; only card refs differ.
    const coordinator = createLocalRuntimeCoordinator({ authority: replayed.value, sessionGeneration: 1 }).value;
    const unref = value => JSON.parse(JSON.stringify(value).replace(/r:[0-9a-f]{32}/g, 'ref'));
    for (const seatId of ['player', 'ai']) {
      const view = coordinator.bind({ seatId }).value.query().value;
      assert.deepEqual(unref(view.observation), unref(session.port(seatId).value.query().value.observation));
    }
    coordinator.dispose();
  } finally { session.dispose(); }
});

test('sandbox control commands are recorded and replayed too', () => {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('sandbox', 'record-sandbox') });
  assert.equal(made.ok, true, JSON.stringify(made));
  const session = made.value;
  try {
    const port = session.port('player').value;
    const control = session.sandboxControl('player').value;
    const added = control.submit({ commandId: 'add', expectedRevision: port.query().value.status.revision,
      action: { type: 'sandboxAddCard', definitionId: 'STD-043', targetSeat: 'player' } });
    assert.equal(added.ok, true, JSON.stringify(added));
    playOut(session, 30);
    const record = session.matchRecord().value;
    assert.equal(record.commands[0].control, true);
    const replayed = replayMatchRecord(record);
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(replayed.value.revision, port.query().value.status.revision);
  } finally { session.dispose(); }
});

test('a replay stops at the first command this build does not accept', () => {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('ai', 'record-broken') });
  const session = made.value;
  try {
    playOut(session, 10);
    const record = session.matchRecord().value;
    record.commands.splice(0, 1);
    const replayed = replayMatchRecord(record);
    assert.equal(replayed.ok, false);
    assert.equal(Number.isInteger(replayed.error.index), true);
  } finally { session.dispose(); }
});

import { loadStored, MATCH_LOGS, MAX_STORED_MATCHES, REPLAYS, saveStored } from '../src/adapters/match-record-store.js';
import { archiveRetiredMatch } from '../src/adapters/match-archive.js';
import { sendMatchLog } from '../src/adapters/match-log-sender.js';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';

const memoryStorage = (limit = Infinity) => {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null,
    setItem(key, value) { if (value.length > limit) throw new Error('QuotaExceededError'); items.set(key, value); } };
};
const fakeReplay = (matchId, size = 1) => ({ kind: 'siege-zeke.replay', schemaVersion: 1, game: { matchId },
  commands: Array.from({ length: size }, () => ({ seat: 'player', action: { type: 'endTurn' } })) });

test('replays are kept newest first, one per match, and the oldest give way', () => {
  const storage = memoryStorage();
  for (let index = 0; index < MAX_STORED_MATCHES + 3; index++) saveStored(storage, REPLAYS, fakeReplay(`m${index}`));
  saveStored(storage, REPLAYS, fakeReplay('m22', 2));
  const replays = loadStored(storage, REPLAYS);
  assert.equal(replays.length, MAX_STORED_MATCHES);
  assert.equal(replays[0].game.matchId, 'm22');
  assert.equal(replays[0].commands.length, 2);
  assert.equal(replays.filter(replay => replay.game.matchId === 'm22').length, 1);
  assert.equal(saveStored(storage, MATCH_LOGS, fakeReplay('wrong-kind')), false);

  const tight = memoryStorage(600);
  for (let index = 0; index < 8; index++) assert.equal(saveStored(tight, REPLAYS, fakeReplay(`t${index}`)), true);
  assert.equal(loadStored(tight, REPLAYS)[0].game.matchId, 't7');
  assert.deepEqual(loadStored({ getItem: () => '{broken' }, REPLAYS), []);
});

test('a finished match leaves a replay and a readable log, and the log is sent only when switched on', () => {
  const storage = memoryStorage(), sent = [];
  const lifecycle = createMatchLifecycleController({ onRetire: session => archiveRetiredMatch(session,
    { storage, sendEnabled: session.scope().matchId === 'archive-on', send: log => { sent.push(log); return true; }, now: new Date(0) }) });
  for (const matchId of ['archive-off', 'archive-on']) playOut(lifecycle.start(runtimeConfig('ai', matchId)).value, 400);
  lifecycle.start(runtimeConfig('ai', 'archive-unfinished'));
  lifecycle.dispose();
  assert.deepEqual(loadStored(storage, REPLAYS).map(replay => replay.game.matchId), ['archive-on', 'archive-off']);
  const logs = loadStored(storage, MATCH_LOGS);
  assert.deepEqual(logs.map(log => log.matchId), ['archive-on', 'archive-off']);
  assert.deepEqual(sent.map(log => log.matchId), ['archive-on']);
  const [log] = sent;
  assert.equal(log.finished, true);
  assert.ok(['you', 'opponent', 'draw'].includes(log.result));
  assert.equal(log.endedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(log.players.you.user.name.length > 0, true);
  assert.equal(log.players.opponent.deck.name, 'NOM・黄');
  assert.equal(log.players.you.deck.cards.reduce((sum, card) => sum + card.count, 0) > 0, true);
  assert.ok(log.log.some(row => row.tag === 'EXEC' && row.card && row.side === 'opponent'));
  assert.ok(log.log.every(row => Number.isInteger(row.turn) && ['you', 'opponent', 'system'].includes(row.side)));
  assert.equal(JSON.stringify(log).includes('r:'), false, 'session refs never leave the game');
  assert.ok(new TextEncoder().encode(JSON.stringify(log)).length < 60000, 'a whole match fits one beacon');
});

test('a log goes by beacon when it can, and by fetch otherwise', () => {
  const calls = [];
  const beacon = (url, blob) => { calls.push(['beacon', url, blob.type]); return false; };
  const post = (url, init) => { calls.push(['fetch', url, init.headers['content-type']]); return Promise.resolve(); };
  assert.equal(sendMatchLog({ kind: 'x' }, { endpoint: 'https://example.test/logs', beacon, post }), true);
  assert.deepEqual(calls.map(call => call[0]), ['beacon', 'fetch']);
  assert.ok(calls.every(call => call[2].toLowerCase() === 'text/plain;charset=utf-8'));
  assert.equal(sendMatchLog({ kind: 'x' }, { beacon: () => true, post: null }), true);
});

test('a log over the beacon cap in bytes skips the beacon and goes by a plain fetch', () => {
  const calls = [];
  const beacon = () => { calls.push('beacon'); return true; };
  const post = (url, init) => { calls.push(['fetch', init.keepalive]); return Promise.resolve(); };
  // 25,000 characters, but 75,000 bytes: under the character count, over the 64 KiB cap.
  assert.equal(sendMatchLog({ text: 'ロ'.repeat(25000) }, { beacon, post }), true);
  assert.deepEqual(calls, [['fetch', false]]);
});

import { readFileSync } from 'node:fs';
import { MATCH_LOG_ENDPOINT } from '../src/adapters/match-log-sender.js';

test('the page CSP lets the log sender reach its endpoint and a picked logo video play', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const csp = headers.split('\n').find(line => line.trim().startsWith('Content-Security-Policy:'));
  const directive = name => csp.split(':').slice(1).join(':').split(';').map(part => part.trim().split(/\s+/)).find(part => part[0] === name) ?? [];
  assert.ok(csp, 'a Content-Security-Policy header is set');
  assert.ok(directive('connect-src').includes(new URL(MATCH_LOG_ENDPOINT).origin), 'beacon and fetch go to the log host');
  assert.ok(directive('media-src').includes('blob:'), 'a <video> on an object URL falls to media-src, not connect-src');
  assert.equal(directive('connect-src').includes('*'), false);
});
