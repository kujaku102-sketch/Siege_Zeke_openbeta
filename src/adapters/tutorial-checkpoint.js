import { restoreRuntimeSnapshot } from '../game/runtime/snapshot.js';
import { createCommandJournal } from '../game/runtime/command-record.js';
import { validateLiveAuthority } from '../game/runtime/live-authority.js';
import { CARD_VERSION, RULE_VERSION } from '../game/runtime/versions.js';
import { tutorialStateData } from './tutorial-mode-controller.js';

export const TUTORIAL_CHECKPOINT_FORMAT = 'siege-zeke.tutorial-checkpoints';
export const TUTORIAL_CHECKPOINT_SCHEMA = 1;

const failure = (code, detail) => ({ ok: false, error: detail ? { code, detail } : { code } });
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const nonempty = value => typeof value === 'string' && value.length > 0;

// A stored snapshot is one fixed match; starting it as a new match gives it a new id. Only the keys
// named matchId change: the same text can be another field's value (the blue tutorial's matchId and
// its deck id are both 'tutorial-blue'), so no value is ever replaced.
function withMatchId(value, matchId) {
  if (Array.isArray(value)) return value.map(item => withMatchId(item, matchId));
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'matchId' ? matchId : withMatchId(item, matchId)]));
}

// file: the tutorial checkpoint file (see scripts/build-tutorial-snapshots.mjs).
// Returns what a new match session needs: the authority (with an empty journal), the guide's state,
// and the runtime config that starts the same tutorial from its beginning (what a rematch uses).
export function loadTutorialCheckpoint(file, checkpointId, { matchId, ruleVersion = RULE_VERSION, cardVersion = CARD_VERSION } = {}) {
  if (!plain(file) || file.format !== TUTORIAL_CHECKPOINT_FORMAT || file.schemaVersion !== TUTORIAL_CHECKPOINT_SCHEMA
    || !nonempty(file.tutorialId) || !plain(file.snapshots) || !Array.isArray(file.checkpoints)
    || !nonempty(matchId) || !nonempty(checkpointId)) return failure('TUTORIAL_CHECKPOINT_INVALID');
  if (file.ruleVersion !== ruleVersion || file.cardVersion !== cardVersion) return failure('TUTORIAL_CHECKPOINT_VERSION');
  const checkpoint = file.checkpoints.find(item => plain(item) && item.id === checkpointId);
  if (!checkpoint) return failure('TUTORIAL_CHECKPOINT_UNKNOWN');
  const stored = Object.hasOwn(file.snapshots, checkpoint.snapshot) ? file.snapshots[checkpoint.snapshot] : null;
  const seatIds = stored?.metadata?.seatIds;
  if (!plain(stored) || !Array.isArray(seatIds)) return failure('TUTORIAL_CHECKPOINT_INVALID');
  const restored = restoreRuntimeSnapshot(withMatchId(stored, matchId), { matchId, seatIds, ruleVersion, cardVersion });
  if (!restored.ok) return failure(restored.error.code === 'SNAPSHOT_VERSION_MISMATCH' ? 'TUTORIAL_CHECKPOINT_VERSION' : 'TUTORIAL_CHECKPOINT_INVALID', restored.error.code);
  const { metadata, revision, engineState, referenceState } = restored.value;
  const options = metadata.startOptions;
  const tutorialState = tutorialStateData(file.tutorialId, checkpoint.tutorial);
  if (options.mode !== 'tutorial' || options.tutorialId !== file.tutorialId || !tutorialState) return failure('TUTORIAL_CHECKPOINT_INVALID');
  const journal = createCommandJournal({ matchId, seatIds: metadata.seatIds });
  if (!journal.ok) return failure('TUTORIAL_CHECKPOINT_INVALID', journal.error.code);
  const authority = { metadata, revision, engineState, referenceState, journal: journal.value };
  if (!validateLiveAuthority(authority).ok) return failure('TUTORIAL_CHECKPOINT_INVALID');
  return { ok: true, value: {
    authority, tutorialState,
    runtimeConfig: { matchId, seatIds: [...metadata.seatIds], seed: engineState.runtimeContext.rngState.seed, ruleVersion, cardVersion,
      gameOptions: structuredClone(options) }
  } };
}
