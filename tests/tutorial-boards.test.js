import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TUTORIAL_BUILD_IDS } from '../scripts/build-tutorial-snapshots.mjs';
import { buildTutorialBoard, tutorialBoardFile } from '../scripts/build-tutorial-boards.mjs';
import { TUTORIAL_WIN_CHECKPOINT, loadTutorialWinBoard } from '../src/tutorial-boards/index.js';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';

const shipped = async id => JSON.parse(await readFile(tutorialBoardFile(id), 'utf8'));

test('the shipped win boards are the ones the builder makes now (a stale one fails: rebuild with --write)', async () => {
  for (const id of TUTORIAL_BUILD_IDS) assert.deepEqual(await shipped(id), buildTutorialBoard(id), `${id}: run node scripts/build-tutorial-boards.mjs --write`);
});

test('each tutorial has its win board and only that: one checkpoint, one snapshot', async () => {
  const index = await readFile(new URL('../src/tutorial-boards/index.js', import.meta.url), 'utf8');
  for (const id of TUTORIAL_BUILD_IDS) {
    assert.ok(index.includes(`${id}: () => import('./${id}.json')`), `${id} is read by the loader`);
    const file = await shipped(id);
    assert.deepEqual(file.checkpoints.map(point => point.id), [TUTORIAL_WIN_CHECKPOINT]);
    assert.equal(Object.keys(file.snapshots).length, 1);
  }
  assert.equal((await loadTutorialWinBoard('green')).error.code, 'TUTORIAL_CHECKPOINT_UNKNOWN');
});

test('a win board starts as a new match: won for the player, the opponent at STR 0, the guide on the closing line', async () => {
  let serial = 0;
  const lifecycle = createMatchLifecycleController({ nextMatchId: () => `skip-${serial += 1}` });
  for (const id of TUTORIAL_BUILD_IDS) {
    const started = lifecycle.startFromCheckpoint({ file: await shipped(id), checkpointId: TUTORIAL_WIN_CHECKPOINT });
    assert.equal(started.ok, true, JSON.stringify(started.error));
    const session = started.value, query = session.port('player').value.query().value, tutorial = session.tutorial().value;
    assert.equal(query.status.matchId, `skip-${serial}`);
    assert.equal(query.status.lockedOutcome?.winnerSeat, 'player', id);
    assert.equal(query.observation.seats.find(seat => seat.seatId !== 'player').fortressStr, 0, id);
    assert.equal(query.requiredInput, null, id);
    assert.equal(tutorial.flow.complete, true, id);
    assert.equal(tutorial.opponentScript, null, id);
  }
  lifecycle.dispose();
});
