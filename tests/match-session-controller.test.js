import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeReferenceFrame } from '../src/game/runtime/reference-frame.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { createCommandJournal } from '../src/game/runtime/command-record.js';
import { createMatchSessionController, createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { createRuntimeClientController } from '../src/adapters/runtime-client-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';

const refToken = index => `r:${index.toString(16).padStart(32, '0')}`;

function trackableCount(frame) {
  const entries = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
  const root = (card, viewer) => card.location.kind === 'board'
    || card.location.kind === 'zone' && card.location.zone === 'hand' && card.controllerSeat === viewer
    || card.location.kind === 'zone' && ['registry', 'trash', 'ban'].includes(card.location.zone) && !card.faceDown;
  const tracked = (card, viewer) => {
    while (card.location.kind === 'mounted') {
      if (card.faceDown) return false;
      card = entries.get(card.location.host.instanceId);
      if (!card) return false;
    }
    return !card.faceDown && root(card, viewer);
  };
  return frame.cards.reduce((count, card) => count
    + frame.seatIds.filter(viewer => tracked(card, viewer)).length, 0);
}

function authority(matchId = 'session-match') {
  const session = createRuntimeSession({
    matchId, seatIds: ['seat-a', 'seat-b'], seed: 41, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: {
      mode: 'ai', playerDeckId: 'red', aiDeckId: 'yellow',
      playerDeckRecipe: [['STD-020', 10]], aiDeckRecipe: [['STD-020', 10]],
      playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
    }
  });
  assert.equal(session.ok, true, JSON.stringify(session));
  const frame = buildRuntimeReferenceFrame(session.value.engineState);
  assert.equal(frame.ok, true, JSON.stringify(frame));
  const references = createRuntimeReferenceState({
    frame: frame.value,
    newRefs: Array.from({ length: trackableCount(frame.value) }, (_, index) => refToken(index + 1))
  });
  assert.equal(references.ok, true, JSON.stringify(references));
  const journal = createCommandJournal({ matchId, seatIds: ['seat-a', 'seat-b'] });
  assert.equal(journal.ok, true, JSON.stringify(journal));
  return { ...session.value, referenceState: references.value, journal: journal.value };
}

function match(generation = 1, matchId = 'session-match') {
  const created = createMatchSessionController({ authority: authority(matchId), sessionGeneration: generation });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
}

function runtimeConfig(matchId = 'new-session-match') {
  return {
    matchId, seatIds: ['seat-a', 'seat-b'], seed: 51, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: {
      mode: 'ai', playerDeckId: 'red', aiDeckId: 'yellow',
      playerDeckRecipe: [['STD-020', 10]], aiDeckRecipe: [['STD-020', 10]],
      playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
    }
  };
}

test('S05-MATCH-01: session exposes only fixed scope and seat-bound managed ports', () => {
  const session = match(7);
  assert.deepEqual(session.scope(), {
    matchId: 'session-match', sessionGeneration: 7, seatIds: ['seat-a', 'seat-b']
  });
  const first = session.port('seat-a');
  const second = session.port('seat-b');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(Object.hasOwn(first.value, 'authority'), false);
  assert.deepEqual(session.port('seat-c'), { ok: false, error: { code: 'MATCH_SESSION_UNKNOWN_SEAT' } });
  assert.equal(first.value.query().value.status.viewerSeat, 'seat-a');
  assert.equal(second.value.query().value.status.viewerSeat, 'seat-b');
});

test('S05-MATCH-02: session allocates runtime command IDs and exact client retry is cached once', () => {
  const session = match(7);
  const first = session.port('seat-a').value;
  const action = { commandId: 'click-1', expectedRevision: 0, action: { type: 'endTurn' } };
  const accepted = first.submit(action);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.value.kind, 'accepted');
  assert.equal(accepted.value.receipt.commandId, 'command:7:1:1');
  const retry = first.submit(action);
  assert.deepEqual(retry, accepted);
  const doubleClick = first.submit({
    commandId: 'click-2', expectedRevision: 0, action: { type: 'endTurn' }
  });
  assert.deepEqual(doubleClick, accepted);
  assert.equal(first.query().value.status.revision, 1);
  assert.deepEqual(first.receipt('click-1'), { ok: true, value: accepted.value.receipt });
  assert.deepEqual(first.receipt('click-2'), { ok: true, value: accepted.value.receipt });
  assert.deepEqual(first.submit({
    commandId: 'click-1', expectedRevision: 1, action: { type: 'endTurn' }
  }), { ok: false, error: { code: 'MATCH_SESSION_COMMAND_COLLISION' } });
});

test('S05-MATCH-03: command allocator is session-wide and preserves seat binding', () => {
  const session = match(3);
  const first = session.port('seat-a').value;
  const second = session.port('seat-b').value;
  const one = first.submit({ commandId: 'a', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(one.ok, true, JSON.stringify(one));
  const two = second.submit({ commandId: 'b', expectedRevision: 1, action: { type: 'endTurn' } });
  assert.equal(two.ok, true, JSON.stringify(two));
  assert.equal(one.value.receipt.commandId, 'command:3:1:1');
  assert.equal(two.value.receipt.commandId, 'command:3:2:2');
  assert.equal(first.query().value.status.revision, 2);
});

test('S05-MATCH-04: latest query never aliases callers and accepted events drain once', () => {
  const session = match();
  const first = session.port('seat-a').value;
  const second = session.port('seat-b').value;
  const before = first.query();
  second.query();
  assert.equal(before.ok, true, JSON.stringify(before));
  before.value.status.revision = 999;
  assert.equal(first.latest().value.status.revision, 0);
  const accepted = first.submit({ commandId: 'event-op', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.deepEqual(second.latest(), { ok: false, error: { code: 'MATCH_SESSION_STALE_RESULT' } });
  assert.equal(second.query().value.status.revision, 1);
  const events = session.takeEvents();
  assert.equal(events.ok, true, JSON.stringify(events));
  assert.ok(events.value.length >= 1);
  assert.equal(events.value[0].eventId, 'event:1:command:1:1:1:0');
  session.port('seat-a').value.submit({ commandId: 'event-op', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.deepEqual(session.takeEvents(), { ok: true, value: [] });
});

test('S05-MATCH-05: dispose revokes ports and tracked controllers in reverse order', () => {
  const session = match();
  const first = session.port('seat-a').value;
  const calls = [];
  session.track({ dispose() { calls.push('first'); } });
  session.track({ dispose() { calls.push('second'); } });
  assert.deepEqual(session.dispose(), { ok: true, value: null });
  assert.deepEqual(calls, ['second', 'first']);
  assert.deepEqual(first.query(), { ok: false, error: { code: 'MATCH_SESSION_DISPOSED' } });
  assert.deepEqual(session.port('seat-a'), { ok: false, error: { code: 'MATCH_SESSION_DISPOSED' } });
  assert.deepEqual(session.takeEvents(), { ok: false, error: { code: 'MATCH_SESSION_DISPOSED' } });
  assert.deepEqual(session.dispose(), { ok: true, value: null });
});

test('S05-MATCH-06: a new generation cannot revive an old port or reuse its runtime scope', () => {
  const oldSession = match(1, 'old-match');
  const oldPort = oldSession.port('seat-a').value;
  oldSession.dispose();
  const next = match(2, 'new-match');
  const nextPort = next.port('seat-a').value;
  assert.deepEqual(oldPort.submit({ commandId: 'late', expectedRevision: 0, action: { type: 'endTurn' } }), {
    ok: false, error: { code: 'MATCH_SESSION_DISPOSED' }
  });
  const accepted = nextPort.submit({ commandId: 'fresh', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.value.receipt.matchId, 'new-match');
  assert.equal(accepted.value.receipt.commandId, 'command:2:1:1');
});

test('S05-MATCH-07: malformed session input and disposable getters fail closed', () => {
  assert.deepEqual(createMatchSessionController(null), { ok: false, error: { code: 'INVALID_MATCH_SESSION' } });
  let called = 0;
  const input = Object.defineProperty({ sessionGeneration: 1 }, 'authority', {
    enumerable: true, get() { called += 1; return authority(); }
  });
  assert.deepEqual(createMatchSessionController(input), { ok: false, error: { code: 'INVALID_MATCH_SESSION' } });
  assert.equal(called, 0);
  const corrupt = authority();
  corrupt.journal = { ...corrupt.journal, matchId: 'foreign-match' };
  assert.deepEqual(createMatchSessionController({ authority: corrupt, sessionGeneration: 1 }), {
    ok: false, error: { code: 'INVALID_MATCH_SESSION' }
  });
  const session = match();
  const disposable = Object.defineProperty({}, 'dispose', {
    enumerable: true, get() { called += 1; return () => {}; }
  });
  assert.deepEqual(session.track(disposable), { ok: false, error: { code: 'INVALID_SESSION_DISPOSABLE' } });
  assert.equal(called, 0);
});

test('S05-MATCH-08: AI controller runs through a managed session port and session owns runtime IDs', () => {
  const session = match(9);
  const port = session.port('seat-a').value;
  let serial = 0;
  const tasks = new Map();
  const scheduler = {
    schedule(task) { const token = ++serial; tasks.set(token, task); return token; },
    cancel(token) { tasks.delete(token); }
  };
  const controller = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler }).value;
  session.track(controller);
  controller.start();
  let steps = 0;
  while (tasks.size && steps < 30) {
    const [token, task] = tasks.entries().next().value;
    tasks.delete(token);
    task();
    steps += 1;
  }
  assert.equal(port.query().value.status.activeSeat, 'seat-b');
  const events = session.takeEvents().value;
  assert.ok(events.length > 0);
  assert.ok(events.every(event => event.commandId.startsWith('command:9:1:')));
  assert.ok(steps < 30);
  session.dispose();
  assert.equal(tasks.size, 0);
});

test('S05-MATCH-09: disposal continues revocation after one tracked cleanup throws', () => {
  const session = match();
  const port = session.port('seat-a').value;
  const cleanupError = new Error('cleanup');
  let finalDisposed = false;
  session.track({ dispose() { finalDisposed = true; } });
  session.track({ dispose() { throw cleanupError; } });
  assert.throws(() => session.dispose(), error => error === cleanupError);
  assert.equal(finalDisposed, true);
  assert.deepEqual(port.query(), { ok: false, error: { code: 'MATCH_SESSION_DISPOSED' } });
});

test('S05-MATCH-10: new-match factory owns runtime, references, journal, and coordinator bootstrap', () => {
  const created = createNewMatchSessionController({ runtimeConfig: runtimeConfig(), sessionGeneration: 4 });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(created.value.scope(), {
    matchId: 'new-session-match', sessionGeneration: 4, seatIds: ['seat-a', 'seat-b']
  });
  const first = created.value.port('seat-a').value;
  const query = first.query();
  assert.equal(query.ok, true, JSON.stringify(query));
  assert.ok(query.value.observation.seats[0].hand.cards.every(card => /^r:[0-9a-f]{32}$/.test(card.cardRef)));
  const submitted = first.submit({ commandId: 'new-turn', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  assert.equal(submitted.value.receipt.commandId, 'command:4:1:1');
});

test('S05-MATCH-11: new-match factory rejects malformed config before exposing a partial session', () => {
  assert.deepEqual(createNewMatchSessionController(null), {
    ok: false, error: { code: 'INVALID_NEW_MATCH_SESSION' }
  });
  assert.deepEqual(createNewMatchSessionController({
    runtimeConfig: { ...runtimeConfig(), matchId: '' }, sessionGeneration: 1
  }), { ok: false, error: { code: 'RUNTIME_INVALID_CONFIG' } });
  assert.deepEqual(createNewMatchSessionController({
    runtimeConfig: runtimeConfig(), sessionGeneration: 0
  }), { ok: false, error: { code: 'INVALID_NEW_MATCH_SESSION' } });
});
