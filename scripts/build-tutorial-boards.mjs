// Builds the tutorial boards the product ships: each tutorial's win only (src/tutorial-boards/<id>.json), cut from
// the full checkpoint file build-tutorial-snapshots.mjs makes. [スキップ] starts it as a new match (文豪, 2026-10-31:
// the step-by-step checkpoints stay in the test repository, the start board is not shipped).
//
//   node scripts/build-tutorial-boards.mjs --write   (rewrites the files)
//   node scripts/build-tutorial-boards.mjs --check   (exit 1 when a shipped board is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TUTORIAL_BUILD_IDS, buildTutorialCheckpoints, checkpointDifferences } from './build-tutorial-snapshots.mjs';
import { TUTORIAL_WIN_CHECKPOINT } from '../src/tutorial-boards/index.js';

export const TUTORIAL_BOARD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tutorial-boards');

// The full file's last point (the winning command accepted, the guide on the closing line) and its snapshot.
export function tutorialWinBoard(full) {
  const last = full.checkpoints.at(-1);
  if (!last?.tutorial.flow.complete) throw new Error(`${full.tutorialId}: the last checkpoint is not the win`);
  return { ...full, snapshots: { [last.snapshot]: full.snapshots[last.snapshot] },
    checkpoints: [{ ...last, id: TUTORIAL_WIN_CHECKPOINT }] };
}

export const buildTutorialBoard = tutorialId => tutorialWinBoard(buildTutorialCheckpoints(tutorialId));
export const tutorialBoardFile = tutorialId => path.join(TUTORIAL_BOARD_DIR, `${tutorialId}.json`);

function main(argv) {
  const write = argv.includes('--write'), check = argv.includes('--check');
  if (write === check) { console.error('usage: build-tutorial-boards.mjs (--write | --check)'); return 2; }
  let stale = 0;
  for (const tutorialId of TUTORIAL_BUILD_IDS) {
    const built = buildTutorialBoard(tutorialId), target = tutorialBoardFile(tutorialId);
    if (write) { writeFileSync(target, `${JSON.stringify(built)}\n`); console.log(`wrote ${target}`); continue; }
    let stored;
    try { stored = JSON.parse(readFileSync(target, 'utf8')); }
    catch { console.log(`STALE ${tutorialId}: ${target} is missing or unreadable`); stale += 1; continue; }
    const differences = checkpointDifferences(stored, built);
    if (differences.length) { stale += 1; console.log(`STALE ${tutorialId}: ${differences.slice(0, 40).join(', ')}`); }
    else console.log(`ok ${tutorialId}`);
  }
  return stale ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
