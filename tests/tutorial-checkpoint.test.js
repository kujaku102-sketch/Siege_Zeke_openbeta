import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';
import { createMatchSessionController } from '../src/adapters/match-session-controller.js';
import { playTutorialToWin } from '../src/adapters/tutorial-autoplay.js';
import { loadTutorialCheckpoint } from '../src/adapters/tutorial-checkpoint.js';
import { createRuntimeSnapshot, restoreRuntimeSnapshot } from '../src/game/runtime/snapshot.js';
import { CARD_VERSION, RULE_VERSION } from '../src/game/runtime/versions.js';
import { buildTutorialCheckpoints, normalizeCheckpointText, playTutorial, tutorialBuildConfig } from '../scripts/build-tutorial-snapshots.mjs';

// Each tutorial is played once for the whole file: its authority at every revision, and the stored file built from it.
const cache = new Map();
function built(tutorialId) {
  if (!cache.has(tutorialId)) {
    const played = playTutorial(tutorialId);
    cache.set(tutorialId, { played, file: buildTutorialCheckpoints(tutorialId, played) });
  }
  return cache.get(tutorialId);
}
const lifecycle = () => createMatchLifecycleController({ nextMatchId: () => crypto.randomUUID() });
const withoutLive = state => { const { rng, history, ...rest } = state; return rest; };

test('a stored snapshot keeps everything JSON keeps, including the contents of script activation windows', () => {
  const { played } = built('vengeance');
  const expected = tutorialBuildConfig('vengeance');
  let withWindows = 0;
  for (const authority of played.authorities) {
    const snapshot = createRuntimeSnapshot({ metadata: authority.metadata, revision: authority.revision,
      engineState: authority.engineState, referenceState: authority.referenceState });
    assert.equal(snapshot.ok, true, `revision ${authority.revision}: ${JSON.stringify(snapshot.error)}`);
    const restored = restoreRuntimeSnapshot(JSON.parse(JSON.stringify(snapshot.value)),
      { matchId: expected.matchId, seatIds: expected.seatIds, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION });
    assert.equal(restored.ok, true, `revision ${authority.revision}: ${JSON.stringify(restored.error)}`);
    assert.deepEqual(withoutLive(restored.value.engineState), withoutLive(JSON.parse(JSON.stringify(authority.engineState))));
    if (authority.engineState.activationWindows.length) {
      withWindows += 1;
      assert.deepEqual(restored.value.engineState.activationWindows, JSON.parse(JSON.stringify(authority.engineState.activationWindows)));
    }
  }
  assert.ok(withWindows > 0, 'the purple tutorial leaves script windows open between commands');
});

test('the blue tutorial stores although its events carry fields without a value', () => {
  const { played, file } = built('blue');
  assert.ok(played.authorities.some(authority => authority.engineState.events.some(event => Object.hasOwn(event, 'color') && event.color === undefined)));
  assert.equal(file.checkpoints.length, 33);
  assert.equal(JSON.stringify(file).includes('undefined'), false);
});

test('building twice gives the same file; references and clock-made ids are normalised', () => {
  const again = buildTutorialCheckpoints('vengeance');
  assert.deepEqual(again, built('vengeance').file);
  const text = JSON.stringify(again);
  assert.equal(/r:[0-9a-f]{32}/.test(text.replace(/r:0{20,}[0-9a-f]+/g, '')), false);
  assert.equal(/\b1[0-9]{12}-/.test(text), false);
  assert.equal(normalizeCheckpointText('{"a":"r:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","b":"r:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","c":"r:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","id":"1761800000123-4"}'),
    '{"a":"r:00000000000000000000000000000001","b":"r:00000000000000000000000000000002","c":"r:00000000000000000000000000000001","id":"T-4"}');
});

test('loading rewrites the match id by key only, and refuses another version, an unknown point or a damaged file', () => {
  const { file } = built('blue');
  const loaded = loadTutorialCheckpoint(file, 'p010', { matchId: 'fresh-match' });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  const { authority, tutorialState, runtimeConfig } = loaded.value;
  assert.equal(authority.metadata.matchId, 'fresh-match');
  assert.equal(authority.engineState.runtimeContext.matchId, 'fresh-match');
  assert.equal(authority.engineState.playerDeckId, 'tutorial-blue', 'the deck id shares the match id text and stays');
  assert.equal(authority.journal.matchId, 'fresh-match');
  assert.equal(authority.revision, file.snapshots[file.checkpoints.find(item => item.id === 'p010').snapshot].revision);
  assert.deepEqual(tutorialState, file.checkpoints.find(item => item.id === 'p010').tutorial);
  assert.deepEqual([runtimeConfig.matchId, runtimeConfig.gameOptions.mode, runtimeConfig.gameOptions.tutorialId], ['fresh-match', 'tutorial', 'blue']);
  assert.equal(JSON.stringify(file).includes('fresh-match'), false, 'the stored file is not touched');

  assert.equal(loadTutorialCheckpoint(file, 'p010', { matchId: 'm', ruleVersion: 'other' }).error.code, 'TUTORIAL_CHECKPOINT_VERSION');
  assert.equal(loadTutorialCheckpoint(file, 'p010', { matchId: 'm', cardVersion: 'other' }).error.code, 'TUTORIAL_CHECKPOINT_VERSION');
  assert.equal(loadTutorialCheckpoint(file, 'nowhere', { matchId: 'm' }).error.code, 'TUTORIAL_CHECKPOINT_UNKNOWN');
  assert.equal(loadTutorialCheckpoint({ ...file, format: 'other' }, 'p010', { matchId: 'm' }).error.code, 'TUTORIAL_CHECKPOINT_INVALID');
  assert.equal(loadTutorialCheckpoint(file, 'p010', {}).error.code, 'TUTORIAL_CHECKPOINT_INVALID');
  const damaged = structuredClone(file);
  delete damaged.snapshots.r5.engineState.players;
  assert.equal(loadTutorialCheckpoint(damaged, file.checkpoints.find(item => item.snapshot === 'r5').id, { matchId: 'm' }).ok, false);
  const badGuide = structuredClone(file);
  badGuide.checkpoints[10].tutorial.flow.index = 99;
  assert.equal(loadTutorialCheckpoint(badGuide, 'p010', { matchId: 'm' }).error.code, 'TUTORIAL_CHECKPOINT_INVALID');
  const otherTutorial = structuredClone(file);
  otherTutorial.tutorialId = 'basics';
  assert.equal(loadTutorialCheckpoint(otherTutorial, 'p010', { matchId: 'm' }).ok, false);
});

test('a checkpoint starts as a new match: new id, empty journal and feed, the guide where it was; a rematch starts over', () => {
  const { file } = built('vengeance');
  const host = lifecycle();
  const first = host.start(tutorialBuildConfig('vengeance'));
  assert.equal(first.ok, true);
  const old = first.value.port('player').value;
  const point = file.checkpoints.find(item => item.at === 'step 8' && item.tutorial.opponentScript === null);
  const started = host.startFromCheckpoint({ file, checkpointId: point.id });
  assert.equal(started.ok, true, JSON.stringify(started));
  const session = started.value;
  assert.equal(old.query().ok, false, 'the running match is replaced');
  assert.notEqual(session.scope().matchId, 'tutorial-vengeance');
  assert.equal(session.scope().sessionGeneration, 2);
  const query = session.port('player').value.query().value;
  assert.equal(query.status.matchId, session.scope().matchId);
  assert.equal(query.status.revision, file.snapshots[point.snapshot].revision);
  assert.deepEqual(session.takeEvents().value, []);
  assert.equal(session.matchRecord().error.code, 'MATCH_RECORD_UNAVAILABLE');
  assert.deepEqual(session.tutorialState().value, point.tutorial);
  const again = host.rematch();
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.value.port('player').value.query().value.status.revision, 0);
  assert.equal(again.value.tutorial().value.flow.index, 0);
  assert.equal(host.startFromCheckpoint({ file, checkpointId: 'nowhere' }).error.code, 'TUTORIAL_CHECKPOINT_UNKNOWN');
  assert.equal(host.current().value, again.value, 'a refused start keeps the running match');
  host.dispose();
});

test('the guide state is carried only into a tutorial session and only when it fits', () => {
  const { file } = built('vengeance');
  const loaded = loadTutorialCheckpoint(file, 'p004', { matchId: 'carried' }).value;
  const make = extra => createMatchSessionController({ authority: loaded.authority, sessionGeneration: 1, ...extra });
  assert.equal(make({ tutorialState: loaded.tutorialState }).ok, true);
  assert.equal(make({ tutorialState: { ...loaded.tutorialState, opponentIndex: 9 } }).error.code, 'INVALID_MATCH_SESSION');
  assert.equal(make({ tutorialState: { ...loaded.tutorialState, extra: true } }).error.code, 'INVALID_MATCH_SESSION');
  assert.equal(make({ tutorialState: undefined }).error.code, 'INVALID_MATCH_SESSION');
  assert.equal(make({ other: 1 }).error.code, 'INVALID_MATCH_SESSION');
  assert.equal(make({}).ok, true);
});

// From a stored point, the tutorial's own script plays on to the win. The sample takes the first and last
// points, an opponent turn in progress, a step whose action is accepted but whose choice is open, and
// one point with a step action already accepted.
test('a new match from stored points plays on to the win', () => {
  const sample = [];
  for (const tutorialId of ['vengeance', 'blue']) {
    const { file } = built(tutorialId);
    const pick = new Set([file.checkpoints[0], file.checkpoints.at(-1), file.checkpoints[Math.floor(file.checkpoints.length / 2)],
      file.checkpoints.find(item => item.tutorial.opponentScript !== null),
      file.checkpoints.find(item => item.tutorial.stepActionAccepted),
      file.checkpoints.find(item => item.tutorial.opponentActionPending)].filter(Boolean));
    for (const point of pick) sample.push({ tutorialId, file, point });
  }
  assert.ok(sample.length >= 8);
  for (const { tutorialId, file, point } of sample) {
    const host = lifecycle();
    const started = host.startFromCheckpoint({ file, checkpointId: point.id });
    assert.equal(started.ok, true, `${tutorialId} ${point.id}: ${JSON.stringify(started)}`);
    const played = playTutorialToWin({ session: started.value });
    assert.equal(played.ok, true, `${tutorialId} ${point.id} (${point.at}): ${JSON.stringify(played)}`);
    assert.equal(started.value.port('player').value.query().value.status.lockedOutcome?.winnerSeat, 'player');
    assert.equal(started.value.tutorial().value.flow.complete, true);
    host.dispose();
  }
});
