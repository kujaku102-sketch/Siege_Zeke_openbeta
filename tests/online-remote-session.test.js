import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSession } from '../src/network/remote-session.js';

// A transport that records what the session sends; `open` turns the socket off.
function setup(options = {}) {
  const sent = [];
  const transport = { open: true, send(message) { if (!transport.open) return false; sent.push(message); return true; } };
  const timers = [];
  const session = createRemoteSession({ matchId: 'ol-1', seat: 'seat-me', opponentSeat: 'seat-them', transport, nonce: 'n1',
    after: (ms, fn) => { timers.push({ ms, fn }); return timers.length - 1; }, cancel: id => { if (timers[id]) timers[id].fn = null; }, ...options });
  return { session, sent, transport, timers };
}
const view = revision => ({ t: 'state', revision, status: { matchId: 'ol-1', revision, viewerSeat: 'seat-me', seats: [] },
  observation: { revision }, requiredInput: null, legalActions: [{ actionId: `action:${revision}:1` }], actionBlocks: { general: null, cards: [] }, events: [] });
const accepted = (commandId, revision) => ({ t: 'ack', commandId, kind: 'accepted', receipt: { commandId, status: 'accepted', revision, reasonCode: 'ACCEPTED' } });
const intent = (commandId = 'gui:1', expectedRevision = 0, action = { type: 'endTurn' }) => ({ commandId, expectedRevision, action });
const settled = promise => Promise.race([promise.then(value => ({ value })), new Promise(resolve => setImmediate(() => resolve(null)))]);

test('it looks like a local session to the page: scope, seats, stamps, nothing before the first state', () => {
  const { session } = setup();
  assert.equal(session.kind, 'remote');
  assert.deepEqual(session.scope(), { matchId: 'ol-1', sessionGeneration: 1, seatIds: ['seat-me', 'seat-them'] });
  assert.equal(session.viewerSeat(), 'seat-me');
  assert.equal(session.port('seat-me').ok, true);
  assert.equal(session.port('seat-them').error.code, 'MATCH_SESSION_UNKNOWN_SEAT', 'the other seat is not readable');
  const port = session.port('seat-me').value;
  assert.equal(port.query().error.code, 'MATCH_SESSION_QUERY_UNAVAILABLE');
  assert.equal(session.readStamp('seat-me').value.available, false);
  assert.equal(session.readStamp('seat-them').error.code, 'MATCH_SESSION_UNKNOWN_SEAT');
  assert.equal(session.matchRecord().error.code, 'MATCH_RECORD_UNAVAILABLE');
  assert.equal(session.tutorial().error.code, 'UNAVAILABLE_MODE');
  assert.equal(session.advanceTutorial().error.code, 'UNAVAILABLE_MODE');
  assert.equal(session.sandboxControl().error.code, 'CAPABILITY_REQUIRED');
  session.receive(view(0));
  assert.deepEqual(Object.keys(port.query().value).sort(), ['actionBlocks', 'legalActions', 'observation', 'requiredInput', 'status']);
  assert.equal(port.latest().value.status.revision, 0);
  assert.deepEqual(session.readStamp('seat-me').value, { matchId: 'ol-1', sessionGeneration: 1, currentRevision: 0, modeEpoch: 0,
    viewerSeat: 'seat-me', adoptedRevision: 0, adoptedModeEpoch: 0, available: true });
});

test('a command is finished when its answer and its new state have both arrived', async () => {
  const { session, sent } = setup();
  const port = session.port('seat-me').value;
  session.receive(view(0));
  const pending = port.submit(intent());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, 'cmd');
  assert.match(sent[0].commandId, /^[\w:.-]{1,64}$/);
  assert.notEqual(sent[0].commandId, 'gui:1', 'the room sees its own id, not the page\'s');
  assert.equal(sent[0].expectedRevision, 0);
  session.receive(accepted(sent[0].commandId, 1));
  assert.equal(await settled(pending), null, 'the ack alone does not finish it');
  session.receive(view(1));
  const done = await pending;
  assert.equal(done.ok, true);
  assert.equal(done.value.kind, 'accepted');
  assert.equal(done.value.receipt.status, 'accepted');
  assert.equal(port.latest().value.status.revision, 1, 'a page that reads now sees the new state');
  assert.equal(port.receipt('gui:1').value.revision, 1);
  assert.equal((await port.submit(intent())).value.receipt.revision, 1, 'the same command again returns the first answer and sends nothing');
  assert.equal(sent.length, 1);
});

test('a refusal is a finished answer; an error leaves the command id free to use again', async () => {
  const { session, sent } = setup();
  const port = session.port('seat-me').value;
  session.receive(view(3));
  const stale = port.submit(intent('gui:1', 1));
  session.receive({ t: 'ack', commandId: sent[0].commandId, kind: 'rejected', receipt: { commandId: sent[0].commandId, status: 'rejected', revision: 3, reasonCode: 'STALE_REVISION' } });
  const answer = await stale;
  assert.equal(answer.ok, true);
  assert.equal(answer.value.receipt.reasonCode, 'STALE_REVISION');
  const clash = port.submit(intent('gui:2', 3));
  session.receive({ t: 'error', code: 'COMMAND_ID_COLLISION', commandId: sent[1].commandId });
  assert.deepEqual((await clash).error, { code: 'COMMAND_ID_COLLISION' });
  assert.equal(port.receipt('gui:2').error.code, 'RECEIPT_NOT_FOUND');
  const again = port.submit(intent('gui:2', 3, { type: 'keepOpeningHand' }));
  assert.equal(sent.length, 3, 'the page can reuse the id with another command');
  session.receive(accepted(sent[2].commandId, 4)); session.receive(view(4));
  assert.equal((await again).ok, true);
  assert.equal((await port.submit(intent('gui:1', 9))).error.code, 'MATCH_SESSION_COMMAND_COLLISION', 'the same id with another command is a clash');
  assert.equal((await port.submit({ commandId: 'x' })).error.code, 'INVALID_SESSION_INTENT');
});

test('while the socket is down a write fails at once; a command already sent is sent again on return', async () => {
  const { session, sent, transport } = setup();
  const port = session.port('seat-me').value;
  session.receive(view(0));
  transport.open = false;
  assert.equal((await port.submit(intent('gui:1'))).error.code, 'REMOTE_DISCONNECTED');
  assert.equal(port.query().ok, true, 'reading still works');
  transport.open = true;
  const inFlight = port.submit(intent('gui:2'));
  const runtimeId = sent.at(-1).commandId;
  transport.open = false;
  session.connectionLost();
  assert.equal((await inFlight).error.code, 'REMOTE_DISCONNECTED');
  assert.equal(port.receipt('gui:2').error.code, 'RECEIPT_NOT_FOUND', 'unknown until the room says');
  transport.open = true;
  session.connectionRestored();
  const before = sent.length;
  session.receive(view(0));
  assert.equal(sent.length, before + 1, 'the unanswered command goes again');
  assert.deepEqual(sent.at(-1), { t: 'cmd', commandId: runtimeId, expectedRevision: 0, action: { type: 'endTurn' } }, 'same id, same payload');
  session.receive({ t: 'ack', commandId: runtimeId, kind: 'retry', receipt: { commandId: runtimeId, status: 'accepted', revision: 1, reasonCode: 'ACCEPTED' } });
  session.receive(view(1));
  assert.equal(port.receipt('gui:2').value.revision, 1, 'the answer that arrived late is kept');
  assert.equal((await port.submit(intent('gui:2'))).value.kind, 'retry');
});

test('a command the room never answers times out, and the page may ask again with the same id', async () => {
  const { session, sent, timers } = setup();
  const port = session.port('seat-me').value;
  session.receive(view(0));
  const waiting = port.submit(intent());
  assert.equal(timers.at(-1).ms, 15000);
  timers.at(-1).fn();
  assert.equal((await waiting).error.code, 'REMOTE_TIMEOUT');
  const second = port.submit(intent());
  assert.equal(sent.length, 2, 'it is sent again');
  assert.equal(sent[1].commandId, sent[0].commandId, 'under the same room id, so the room answers with the first result if it ran');
  session.receive(accepted(sent[1].commandId, 1)); session.receive(view(1));
  assert.equal((await second).ok, true);
});

test('plans and card inspections are questions to the room, answered by their request id', async () => {
  const { session, sent, transport } = setup();
  const port = session.port('seat-me').value;
  session.receive(view(2));
  const plan = port.queryAction({ expectedRevision: 2, actionId: 'action:2:1', selections: [] });
  assert.equal(sent[0].t, 'plan');
  assert.deepEqual({ ...sent[0], rid: null }, { t: 'plan', rid: null, expectedRevision: 2, actionId: 'action:2:1', selections: [] });
  session.receive({ t: 'planResult', rid: sent[0].rid, result: { selectionRequests: [{ requestId: 'r' }], completion: null } });
  assert.deepEqual((await plan).value.selectionRequests, [{ requestId: 'r' }]);
  const refused = port.queryAction({ expectedRevision: 2, actionId: 'action:2:9', selections: [] });
  session.receive({ t: 'planResult', rid: sent[1].rid, error: { code: 'ACTION_NOT_ALLOWED' } });
  assert.deepEqual((await refused).error, { code: 'ACTION_NOT_ALLOWED' });
  const ref = `r:${'a'.repeat(32)}`;
  const inspect = port.query({ inspectRef: ref });
  assert.deepEqual({ ...sent[2], rid: null }, { t: 'inspect', rid: null, ref });
  session.receive({ t: 'inspectResult', rid: sent[2].rid, result: { name: 'x' } });
  const read = await inspect;
  assert.deepEqual(read.value.inspection, { name: 'x' });
  assert.equal(read.value.status.revision, 2, 'an inspection comes with the current read');
  assert.equal((await port.query({ inspectRef: 'nope' })).error.code, 'INVALID_QUERY_INPUT');
  assert.equal((await port.queryAction({ actionId: 'a' })).error.code, 'INVALID_PLANNING_INPUT');
  const lost = port.queryAction({ expectedRevision: 2, actionId: 'action:2:1', selections: [] });
  session.connectionLost();
  assert.equal((await lost).error.code, 'REMOTE_DISCONNECTED');
  transport.open = false;
  assert.equal((await port.queryAction({ expectedRevision: 2, actionId: 'action:2:1', selections: [] })).error.code, 'REMOTE_DISCONNECTED');
});

test('the event feed grows with each state, never repeats an event, and is read from a cursor', () => {
  const { session } = setup();
  const port = session.port('seat-me').value;
  const event = id => ({ eventId: id, type: 'x' });
  session.receive({ ...view(0), events: [] });
  session.receive({ ...view(1), events: [event('e1'), event('e2')] });
  session.receive({ ...view(1), events: [event('e2')] });
  session.receive({ ...view(2), events: [event('e3')] });
  assert.deepEqual(port.events().value.events.map(item => item.eventId), ['e1', 'e2', 'e3']);
  assert.equal(port.events().value.cursor, 'e3');
  assert.deepEqual(port.events({ afterEventId: 'e1' }).value.events.map(item => item.eventId), ['e2', 'e3']);
  assert.equal(port.events({ afterEventId: 'nope' }).error.code, 'UNKNOWN_EVENT_CURSOR');
  assert.deepEqual(session.takeEvents().value.map(item => item.eventId), ['e1', 'e2', 'e3']);
  assert.deepEqual(session.takeEvents().value, [], 'taken once');
  session.receive({ ...view(3), events: [event('e4')] });
  assert.deepEqual(session.takeEvents().value.map(item => item.eventId), ['e4']);
  session.receive({ ...view(2), events: [event('late')] });
  assert.equal(port.latest().value.status.revision, 3, 'an older state does not replace a newer one');
});

test('the record is kept when the match ends, and a disposed session answers nothing', async () => {
  const { session, sent } = setup();
  const port = session.port('seat-me').value;
  const disposed = [];
  session.track({ dispose: () => disposed.push('surface') });
  session.receive(view(0));
  session.receive({ t: 'end', outcome: 'win', reason: 'normal', record: { kind: 'siege-zeke.replay', commands: [] } });
  assert.equal(session.matchRecord().value.kind, 'siege-zeke.replay');
  const waiting = port.submit(intent());
  session.dispose();
  assert.deepEqual(disposed, ['surface']);
  assert.equal((await waiting).error.code, 'REMOTE_DISCONNECTED');
  assert.equal(port.query().error.code, 'MATCH_SESSION_DISPOSED');
  assert.equal((await port.submit(intent('gui:9'))).error.code, 'MATCH_SESSION_DISPOSED');
  assert.equal(session.readStamp('seat-me').error.code, 'MATCH_SESSION_DISPOSED');
  assert.equal(sent.length, 1);
});

test('onChange tells the page each time a state or the end arrives, until it unsubscribes or the session is disposed', () => {
  const { session } = setup();
  let calls = 0;
  const stop = session.onChange(() => { calls += 1; });
  session.receive(view(0));
  session.receive(view(1));
  assert.equal(calls, 2);
  session.receive({ t: 'end', outcome: 'win', reason: 'normal', record: { kind: 'siege-zeke.replay', commands: [] } });
  assert.equal(calls, 3);
  stop();
  session.receive(view(2));
  assert.equal(calls, 3);
  session.onChange(() => { throw new Error('a screen failed'); });
  session.receive(view(3));
  assert.equal(session.port('seat-me').value.latest().value.status.revision, 3, 'a listener that throws does not break the session');
  let after = 0;
  session.onChange(() => { after += 1; });
  session.dispose();
  session.receive(view(4));
  assert.equal(after, 0);
});
