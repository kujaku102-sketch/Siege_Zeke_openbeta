import { validateCommandJournal } from './command-record.js';
import { buildRuntimeReferenceFrame } from './reference-frame.js';
import { planRuntimeReferenceTransition } from './references.js';
import { projectRuntimeView } from './projection.js';
import { buildRequiredInput } from './required-input.js';
import { runtimePlanningReads } from './command-bridge.js';

// Live sessions include pending choices and sandbox state. Snapshot's intentionally
// narrower serialization contract is not a live-session eligibility rule.
export function validateLiveAuthority(input) {
  try {
    const keys = ['metadata', 'revision', 'engineState', 'referenceState', 'journal'];
    if (!input || Object.getPrototypeOf(input) !== Object.prototype
      || Reflect.ownKeys(input).length !== keys.length) throw new Error();
    const root = {};
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new Error();
      root[key] = field.value;
    }
    const metadata = runtimePlanningReads.metadataData(root.metadata);
    runtimePlanningReads.engineData(root.engineState, metadata);
    if (!Number.isSafeInteger(root.revision) || root.revision < 0 || Object.is(root.revision, -0)) throw new Error();
    const journal = validateCommandJournal(root.journal);
    if (!journal.ok || journal.value.matchId !== metadata.matchId
      || journal.value.seatIds.some((seat, index) => seat !== metadata.seatIds[index])) throw new Error();
    const frame = buildRuntimeReferenceFrame(root.engineState);
    if (!frame.ok) throw new Error();
    const transition = planRuntimeReferenceTransition(root.referenceState, {
      beforeFrame: frame.value, afterFrame: frame.value
    });
    if (!transition.ok || transition.value.newRefCount || transition.value.invalidatedIdentities.length) throw new Error();
    for (const viewerSeat of metadata.seatIds) {
      const view = projectRuntimeView(root.engineState, root.referenceState, {
        matchId: metadata.matchId, viewerSeat, revision: root.revision
      });
      if (!view.ok || !buildRequiredInput(root, viewerSeat).ok) throw new Error();
    }
    return { ok: true, value: null };
  } catch {
    return { ok: false, error: { code: 'INVALID_LIVE_AUTHORITY' } };
  }
}
