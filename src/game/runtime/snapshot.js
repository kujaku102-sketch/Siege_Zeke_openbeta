import { cloneForHistory } from '../engine.js';
import { restoreRngState } from './rng.js';
import { FORMAT, snapshotEnvelope } from './snapshot/envelope.js';
import { checkRuntime, consistency } from './snapshot/consistency.js';
import { FORMAT_ERROR, INVALID, SCOPE, SnapshotError, STATE, UNSUPPORTED, VERSION, copyJson, exact, nonempty, reject, sameArray, seatIds } from './snapshot/guards.js';
import { metadataData } from './snapshot/metadata.js';
import { allowedRootKeys, runtimeData, snapshotState, stateData, validateRootNumbers } from './snapshot/state-shape.js';

function envelope(code, action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof SnapshotError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function createRuntimeSnapshot(input) {
  return envelope(INVALID, () => {
    const args = exact(input, ['metadata', 'revision', 'engineState', 'referenceState'], INVALID);
    const metadata = metadataData(args.metadata, INVALID);
    const liveState = allowedRootKeys(args.engineState, UNSUPPORTED, true);
    validateRootNumbers(liveState);
    const engineState = copyJson(liveState, UNSUPPORTED, new Set(), true);
    const state = stateData(engineState, { rootCode: UNSUPPORTED, busy: false });
    const referenceState = copyJson(args.referenceState, STATE, new Set(), true);
    snapshotState(state, metadata, referenceState, args.revision);
    consistency(metadata, state, args.revision);
    checkRuntime(state, referenceState, metadata, args.revision);
    return {
      format: FORMAT, schemaVersion: 1, metadata: copyJson(metadata, UNSUPPORTED), revision: args.revision,
      engineState, referenceState
    };
  });
}

export function restoreRuntimeSnapshot(snapshot, expected) {
  return envelope(INVALID, () => {
    const binding = exact(expected, ['matchId', 'seatIds', 'ruleVersion', 'cardVersion'], INVALID);
    binding.seatIds = seatIds(binding.seatIds, INVALID);
    if (!nonempty(binding.matchId) || !nonempty(binding.ruleVersion) || !nonempty(binding.cardVersion)) reject(INVALID);
    const raw = snapshotEnvelope(snapshot);
    const revision = raw.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) reject(INVALID);
    validateRootNumbers(raw.engineState, INVALID);
    const rawMetadata = copyJson(raw.metadata, INVALID);
    const references = copyJson(raw.referenceState, INVALID);
    const copiedState = copyJson(raw.engineState, INVALID);
    const metadata = metadataData(rawMetadata, INVALID);
    const state = stateData(copiedState, { rootCode: UNSUPPORTED, runtime: false, busy: false });
    if (binding.matchId !== metadata.matchId || !sameArray(binding.seatIds, metadata.seatIds)) reject(SCOPE);
    if (binding.ruleVersion !== metadata.ruleVersion || binding.cardVersion !== metadata.cardVersion) reject(VERSION);
    runtimeData(state);
    snapshotState(state, metadata, references, revision);
    consistency(metadata, state, revision);
    checkRuntime(state, references, metadata, revision);
    const restored = cloneForHistory({ ...state, rng: null, history: [] });
    validateRootNumbers(restored);
    const rng = restoreRngState(restored.runtimeContext.rngState);
    if (!rng.ok) reject(rng.error.code === 'RNG_UNSUPPORTED_FORMAT' ? FORMAT_ERROR : STATE);
    snapshotState(restored, metadata, references, revision);
    consistency(metadata, restored, revision);
    checkRuntime(restored, references, metadata, revision);
    return { metadata: copyJson(metadata, INVALID), revision, engineState: restored, referenceState: references };
  });
}
