import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatchAuthority } from '../src/game/runtime/authority.js';
import { createMatchAuthority as controllerExport } from '../src/adapters/match-session-controller.js';
import { createLocalRuntimeCoordinator } from '../src/adapters/local-runtime-port.js';
import { runSimpleAiPortStep } from '../src/adapters/simple-ai-policy.js';
import { replayMatchRecord } from '../src/adapters/match-replay.js';
import { createMatchRecord, decodeRecordedAction } from '../src/game/runtime/match-record.js';
import { makeBoundCommand } from '../src/adapters/port-contract.js';
import { submitRuntimeCommand, submitRuntimeSystemForfeit } from '../src/game/runtime/transaction.js';
import { validateLiveAuthority } from '../src/game/runtime/live-authority.js';
import { runtimeProgress } from '../src/game/runtime/public-result.js';
import { RULE_VERSION, CARD_VERSION } from '../src/game/runtime/versions.js';
import { runtimeComponentRows } from '../src/data/component-rows.js';
import { runtimeComponents } from '../src/ui/runtime-components.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEATS = ['seat-a', 'seat-b'];
const config = (seed = 5, gameOptions = { mode: 'versus', openingProtocol: 'v2.4' }) => ({
  matchId: `server-entry-${seed}`, seatIds: SEATS, seed, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION, gameOptions
});

// What a Worker loads when it imports the runtime: nothing from the page (UI, adapters, main), and no DOM or import.meta.url on the way.
const SERVER_ENTRIES = ['authority', 'transaction', 'live-authority', 'projection', 'event-feed', 'query', 'legal-actions', 'action-planning',
  'required-input', 'command-record', 'match-record', 'session'].map(name => `src/game/runtime/${name}.js`);
const PAGE_ONLY = /^src\/(ui|ui-refresh|adapters|main\.js)/;
// (`window` is also a name in the rules code: an activation window. Only the browser global counts.)
const BROWSER_ONLY = /import\.meta\.url|\bdocument\.|\blocalStorage\b|\bsessionStorage\b|typeof window|globalThis\.window|\bwindow\.(location|document|localStorage|addEventListener|requestAnimationFrame)/;

function reachable(entries) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file) || !existsSync(path.join(root, file))) return;
    seen.add(file);
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      visit(path.relative(root, path.resolve(root, path.dirname(file), specifier)).split(path.sep).join('/'));
    }
  };
  entries.forEach(visit);
  return [...seen];
}

test('the server entries reach no page code, no DOM and no import.meta.url', () => {
  const files = reachable(SERVER_ENTRIES);
  assert.ok(files.length > 100, 'the walk found the runtime');
  assert.deepEqual(files.filter(file => PAGE_ONLY.test(file)), []);
  const stripped = file => readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual(files.filter(file => BROWSER_ONLY.test(stripped(file))), []);
});

test('createMatchAuthority lives in the runtime, and the session controller still offers the same function', () => {
  assert.equal(controllerExport, createMatchAuthority);
  const created = createMatchAuthority(config());
  assert.equal(created.ok, true);
  assert.deepEqual(Object.keys(created.value).sort(), ['engineState', 'journal', 'metadata', 'referenceState', 'revision']);
});

test('the inspector rows are pure data; the UI adds only the badge image', () => {
  const card = { grantedKeywords: ['Security', 'BACKUP'], load: 2, counters: { poison: 1 }, protect: 1, timedModifiers: [{ expiresAfterTurn: 4, atk: 1 }] };
  const rows = runtimeComponentRows(card, 3);
  assert.ok(rows.length >= 5);
  assert.ok(rows.every(row => !('asset' in row)));
  assert.deepEqual(runtimeComponents(card, 3).map(({ asset, ...rest }) => rest), rows);
  assert.equal(runtimeComponents(card, 3).find(row => row.abilityName === 'SECURITY').label, 'セキュリティ');
});

test('a record whose last command is the server forfeit plays back to the same end', () => {
  const start = createMatchAuthority(config()).value;
  for (const action of [{ type: 'systemForfeit', reason: 'disconnect' }, { type: 'concede' }]) {
    const record = createMatchRecord(start).value;
    record.commands.push({ seat: 'seat-b', action });
    const replayed = replayMatchRecord(record);
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(replayed.value.engineState.winner, 'player');
    assert.equal(replayed.value.engineState.victory.finishReason, action.type === 'concede' ? 'concede' : 'disconnect');
  }
});

// Two CPU controllers play a whole human-vs-human match; after every command either seat could concede and the server could forfeit,
// and the match must stay a valid live match each time (no card is lost in flight, nothing is left open).
test('at every step of a played match, a concession or a forfeit ends it as a valid finished match', () => {
  // The engine holds functions, so an authority is not cloned: the same config makes the same match twice.
  const coordinator = createLocalRuntimeCoordinator({ authority: createMatchAuthority(config(7)).value, sessionGeneration: 1 }).value;
  const ports = SEATS.map(seatId => coordinator.bind({ seatId }).value);
  for (let step = 0, stuck = 0; step < 900 && stuck < 4; step += 1) {
    const moved = ports.some(port => port.query().value.status.progress !== 'finished'
      && runSimpleAiPortStep(port, `step-${step}-${port === ports[0] ? 1 : 2}`).value?.kind === 'accepted');
    stuck = moved ? 0 : stuck + 1;
  }
  const record = coordinator.matchRecord().value;
  assert.ok(record.commands.length > 30, 'the match was played');
  let authority = createMatchAuthority(config(7)).value;
  let checked = 0;
  const finishes = current => {
    if (current.engineState.victory.finished) return;
    for (const seat of SEATS) {
      const command = { contractVersion: 1, matchId: current.metadata.matchId, commandId: 'concede', actorSeat: seat, expectedRevision: current.revision, action: { type: 'concede' } };
      const result = submitRuntimeCommand(current, { matchId: command.matchId, actorSeat: seat }, command);
      assert.equal(result.ok && result.value.kind, 'accepted', `revision ${current.revision}: ${JSON.stringify(result.error ?? result.value?.receipt)}`);
      assert.equal(validateLiveAuthority(result.value.authority).ok, true, `revision ${current.revision}`);
      assert.equal(runtimeProgress(result.value.authority.engineState), 'finished');
      assert.equal(result.value.authority.engineState.winner, seat === 'seat-a' ? 'ai' : 'player');
    }
    const forfeit = submitRuntimeSystemForfeit(current, { seat: 'seat-a', reason: 'disconnect' });
    assert.equal(forfeit.ok, true, `revision ${current.revision}: ${JSON.stringify(forfeit.error)}`);
    assert.equal(validateLiveAuthority(forfeit.value.authority).ok, true);
    checked += 1;
  };
  finishes(authority);
  for (const [index, recorded] of record.commands.entries()) {
    const action = decodeRecordedAction(authority, recorded.seat, recorded.action).value;
    const bound = makeBoundCommand({ contractVersion: 1, matchId: authority.metadata.matchId, seatId: recorded.seat, seatIds: [...SEATS], sessionGeneration: 1 },
      { commandId: `replay:${index}`, expectedRevision: authority.revision, action }).value;
    authority = submitRuntimeCommand(authority, { matchId: bound.matchId, actorSeat: recorded.seat }, bound).value.authority;
    finishes(authority);
  }
  assert.ok(checked > 30);
});
