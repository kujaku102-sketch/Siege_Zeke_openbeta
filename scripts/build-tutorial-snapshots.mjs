// Builds the tutorial checkpoint files: for each tutorial, a stored snapshot of the match at every point
// the guide moves (each accepted command, each line advanced), with the guide's own state beside it.
// The tutorial is played by its own script (tutorial-autoplay.js) on a fixed seed and match id, and the
// recorded commands are replayed to read the authority at every revision.
//
//   node scripts/build-tutorial-snapshots.mjs --write --out <dir> [--tutorial basics|vengeance|blue]
//   node scripts/build-tutorial-snapshots.mjs --check --out <dir> [--tutorial ...]   (exit 1 when a stored file is stale)
//
// There is no default directory: the files are test fixtures and live outside this repository.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMatchAuthority, createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { playTutorialToWin } from '../src/adapters/tutorial-autoplay.js';
import { TUTORIAL_CHECKPOINT_FORMAT, TUTORIAL_CHECKPOINT_SCHEMA, loadTutorialCheckpoint } from '../src/adapters/tutorial-checkpoint.js';
import { makeBoundCommand } from '../src/adapters/port-contract.js';
import { decodeRecordedAction } from '../src/game/runtime/match-record.js';
import { createRuntimeSnapshot } from '../src/game/runtime/snapshot.js';
import { submitRuntimeCommand } from '../src/game/runtime/transaction.js';
import { CARD_VERSION, RULE_VERSION } from '../src/game/runtime/versions.js';

export const TUTORIAL_BUILD_IDS = Object.freeze(['basics', 'vengeance', 'blue']);
export const TUTORIAL_BUILD_SEED = 20261030;

// What the host starts a tutorial with (main.js startMatch), on a fixed seed and match id.
export const tutorialBuildConfig = tutorialId => ({
  matchId: `tutorial-${tutorialId}`, seatIds: ['player', 'ai'], seed: TUTORIAL_BUILD_SEED, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION,
  gameOptions: { mode: 'tutorial', tutorialId, playerDeckId: 'red', aiDeckId: 'yellow', playerDeckRecipe: null, aiDeckRecipe: null,
    playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false }
});

// Plays the tutorial and notes the guide's state after the start and after each accepted command or advanced line.
function playAndNote(tutorialId) {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: tutorialBuildConfig(tutorialId) });
  if (!made.ok) throw new Error(`${tutorialId}: cannot start (${made.error.code})`);
  const session = made.value;
  const points = [];
  const note = kind => {
    const status = session.port('player').value.query().value.status;
    points.push({ kind, revision: status.revision, tutorial: session.tutorialState().value });
  };
  note('start');
  const watched = {};
  for (const key of Object.keys(session)) watched[key] = typeof session[key] === 'function' ? session[key].bind(session) : session[key];
  watched.port = seat => {
    const bound = session.port(seat);
    if (!bound.ok) return bound;
    return { ok: true, value: { ...bound.value, submit: intent => {
      const result = bound.value.submit(intent);
      if (result.ok && result.value.kind === 'accepted') note('submit');
      return result;
    } } };
  };
  watched.advanceTutorial = () => {
    const result = session.advanceTutorial();
    if (result.ok) note('advance');
    return result;
  };
  const played = playTutorialToWin({ session: watched });
  if (!played.ok) throw new Error(`${tutorialId}: autoplay failed (${played.error.code})`);
  const record = session.matchRecord();
  if (!record.ok) throw new Error(`${tutorialId}: no match record (${record.error.code})`);
  session.dispose();
  return { points, record: record.value };
}

// The authority at every revision, from the record's own commands.
function authoritiesOf(tutorialId, record) {
  const created = createMatchAuthority(structuredClone(record.game));
  if (!created.ok) throw new Error(`${tutorialId}: cannot rebuild the start (${created.error.code})`);
  let authority = created.value;
  const all = [authority];
  for (const [index, command] of record.commands.entries()) {
    const action = decodeRecordedAction(authority, command.seat, command.action);
    const { matchId, seatIds } = authority.metadata;
    const bound = makeBoundCommand({ contractVersion: 1, matchId, seatId: command.seat, seatIds: [...seatIds], sessionGeneration: 1 },
      { commandId: `replay:${index}`, expectedRevision: authority.revision, action: action.value });
    const result = submitRuntimeCommand(authority, { matchId, actorSeat: command.seat }, bound.value, { tutorialAuthorized: true });
    if (!result.ok || result.value.kind !== 'accepted') throw new Error(`${tutorialId}: replay stopped at command ${index}`);
    authority = result.value.authority;
    all.push(authority);
  }
  return all;
}

// Card references are random on every build and log ids start with the clock; both would make every
// rebuild differ. References become counters in order of appearance; the clock part of an id becomes
// fixed text. Nothing else in a rebuild differs (same seed, same match id).
export function normalizeCheckpointText(text) {
  const refs = new Map();
  return text
    .replace(/r:[0-9a-f]{32}/g, ref => {
      if (!refs.has(ref)) refs.set(ref, `r:${(refs.size + 1).toString(16).padStart(32, '0')}`);
      return refs.get(ref);
    })
    .replace(/\b1[0-9]{12}-(?=[0-9]+")/g, 'T-')
    .replace(/\bSEL-1[0-9]{12}\b/g, 'SEL-T');
}

// The tutorial played to its win: the guide's state at every point, and the authority at every revision.
export function playTutorial(tutorialId) {
  const { points, record } = playAndNote(tutorialId);
  return { points, authorities: authoritiesOf(tutorialId, record) };
}

export function buildTutorialCheckpoints(tutorialId, played = playTutorial(tutorialId)) {
  const { points, authorities } = played;
  const snapshots = {};
  const checkpoints = [];
  for (const [serial, point] of points.entries()) {
    const key = `r${point.revision}`;
    if (!snapshots[key]) {
      const a = authorities[point.revision];
      const made = createRuntimeSnapshot({ metadata: a.metadata, revision: a.revision, engineState: a.engineState, referenceState: a.referenceState });
      if (!made.ok) throw new Error(`${tutorialId}: revision ${point.revision} cannot be stored (${made.error.code})`);
      snapshots[key] = made.value;
    }
    const flow = point.tutorial.flow;
    checkpoints.push({ id: `p${String(serial).padStart(3, '0')}`, snapshot: key, kind: point.kind,
      at: flow.introComplete ? `step ${flow.index}` : `intro ${flow.introIndex}`, tutorial: point.tutorial });
  }
  const file = { format: TUTORIAL_CHECKPOINT_FORMAT, schemaVersion: TUTORIAL_CHECKPOINT_SCHEMA, tutorialId,
    ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION, seed: TUTORIAL_BUILD_SEED, snapshots, checkpoints };
  const normalized = JSON.parse(normalizeCheckpointText(JSON.stringify(file)));
  for (const checkpoint of normalized.checkpoints) {
    const loaded = loadTutorialCheckpoint(normalized, checkpoint.id, { matchId: 'build-check' });
    if (!loaded.ok) throw new Error(`${tutorialId}: ${checkpoint.id} does not load (${loaded.error.code} ${loaded.error.detail ?? ''})`);
  }
  return normalized;
}

// Where two files differ, as short paths (never the contents): the checkpoint, then the key chain to `depth`.
export function checkpointDifferences(stored, built, depth = 3) {
  const found = [];
  const visit = (a, b, trail) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const objects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b);
    if (!objects || trail.length >= depth) { found.push(trail.join('.')); return; }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], [...trail, key]);
  };
  visit(stored, built, []);
  return found;
}

const fileFor = (dir, tutorialId) => path.join(dir, `${tutorialId}.json`);

function main(argv) {
  const option = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null; };
  const write = argv.includes('--write'), check = argv.includes('--check');
  const dir = option('--out');
  if (write === check || !dir) {
    console.error('usage: build-tutorial-snapshots.mjs (--write | --check) --out <dir> [--tutorial basics|vengeance|blue]');
    return 2;
  }
  const only = option('--tutorial');
  if (only && !TUTORIAL_BUILD_IDS.includes(only)) { console.error(`unknown tutorial: ${only}`); return 2; }
  let stale = 0;
  for (const tutorialId of only ? [only] : TUTORIAL_BUILD_IDS) {
    const built = buildTutorialCheckpoints(tutorialId);
    const target = fileFor(dir, tutorialId);
    const summary = `${tutorialId}: ${built.checkpoints.length} checkpoints, ${Object.keys(built.snapshots).length} snapshots`;
    if (write) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, JSON.stringify(built));
      console.log(`wrote ${target} (${summary})`);
      continue;
    }
    let stored;
    try { stored = JSON.parse(readFileSync(target, 'utf8')); }
    catch { console.log(`STALE ${tutorialId}: ${target} is missing or unreadable`); stale += 1; continue; }
    const differences = checkpointDifferences(stored, built);
    if (differences.length) {
      stale += 1;
      console.log(`STALE ${tutorialId}: ${differences.length} places differ`);
      for (const place of differences.slice(0, 40)) console.log(`  ${place}`);
      if (differences.length > 40) console.log(`  ... ${differences.length - 40} more`);
    } else console.log(`ok ${summary}`);
  }
  return stale ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
