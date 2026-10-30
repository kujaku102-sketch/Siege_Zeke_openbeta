import { INPUT, INVALID_REF, ReferenceError, TRANSITION, dense, exact, identity, nonempty, reject } from './references/guards.js';
import { frameData, scope, stateData, tracking } from './references/frame-state.js';
import { allocate, newTokens, transitionPlan } from './references/transition.js';

function envelope(action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof ReferenceError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function createRuntimeReferenceState(args) {
  return envelope(() => {
    const input = exact(args, ['frame', 'newRefs'], INPUT);
    const frame = frameData(input.frame);
    const supplied = newTokens(input.newRefs);
    const state = { matchId: frame.matchId, seatIds: [...frame.seatIds], issuedRefs: [], entries: [] };
    return allocate(state, frame, tracking(frame), supplied);
  });
}
export function planRuntimeReferenceCreation(inputFrame) {
  return envelope(() => {
    const frame = frameData(inputFrame);
    const tracked = tracking(frame);
    let newRefCount = 0;
    for (const card of frame.cards) for (const viewerSeat of frame.seatIds) {
      if (tracked.trackable(card, viewerSeat)) newRefCount += 1;
    }
    return { newRefCount };
  });
}
export function advanceRuntimeReferenceState(inputState, args) {
  return envelope(() => {
    const input = exact(args, ['frame', 'invalidatedIdentities', 'newRefs'], INPUT);
    const state = stateData(inputState);
    const frame = frameData(input.frame);
    scope(state, frame);
    const invalidated = dense(input.invalidatedIdentities, INPUT).map(ref => identity(ref, INPUT));
    if (invalidated.some(ref => ref.matchId !== state.matchId) || new Set(invalidated.map(ref => ref.instanceId)).size !== invalidated.length) reject(TRANSITION);
    const supplied = newTokens(input.newRefs);
    const invalidIds = new Set(invalidated.map(ref => ref.instanceId));
    const tracked = tracking(frame);
    state.entries = state.entries.filter(entry => {
      const card = tracked.cards.get(entry.identity.instanceId);
      return !invalidIds.has(entry.identity.instanceId) && card && tracked.trackable(card, entry.viewerSeat);
    });
    return allocate(state, frame, tracked, supplied);
  });
}
export function planRuntimeReferenceTransition(inputState, args) {
  return envelope(() => {
    const input = exact(args, ['beforeFrame', 'afterFrame'], INPUT);
    const plan = transitionPlan(inputState, input.beforeFrame, input.afterFrame);
    return { invalidatedIdentities: plan.invalidated.map(ref => ({ ...ref })), newRefCount: plan.newRefCount };
  });
}
export function advanceRuntimeReferenceTransition(inputState, args) {
  return envelope(() => {
    const input = exact(args, ['beforeFrame', 'afterFrame', 'newRefs'], INPUT);
    const plan = transitionPlan(inputState, input.beforeFrame, input.afterFrame);
    const supplied = newTokens(input.newRefs);
    if (supplied.length !== plan.newRefCount) reject(TRANSITION);
    const result = advanceRuntimeReferenceState(inputState, {
      frame: input.afterFrame,
      invalidatedIdentities: plan.invalidated.map(ref => ({ ...ref })),
      newRefs: supplied
    });
    if (!result.ok) reject(result.error.code);
    return result.value;
  });
}
function lookupInput(inputState, args, byIdentity) {
  const input = exact(args, ['frame', 'matchId', 'viewerSeat', byIdentity ? 'identity' : 'cardRef'], INPUT);
  if (!nonempty(input.matchId) || !nonempty(input.viewerSeat)) reject(INPUT);
  if (byIdentity) input.identity = identity(input.identity, INPUT);
  else if (typeof input.cardRef !== 'string') reject(INPUT);
  const state = stateData(inputState);
  const frame = frameData(input.frame);
  scope(state, frame, INVALID_REF);
  if (input.matchId !== state.matchId || !state.seatIds.includes(input.viewerSeat) || byIdentity && input.identity.matchId !== state.matchId) reject(INVALID_REF);
  const tracked = tracking(frame);
  const entry = byIdentity
    ? state.entries.find(entry => entry.viewerSeat === input.viewerSeat && entry.identity.instanceId === input.identity.instanceId)
    : state.entries.find(entry => entry.viewerSeat === input.viewerSeat && entry.cardRef === input.cardRef);
  const card = tracked.cards.get(byIdentity ? input.identity.instanceId : entry?.identity.instanceId);
  if (!card || !tracked.trackable(card, input.viewerSeat)) reject(INVALID_REF);
  if (!entry) reject(byIdentity ? 'REF_MAPPING_MISSING' : INVALID_REF);
  return entry;
}
export function findRuntimeCardReference(state, args) {
  return envelope(() => ({ cardRef: lookupInput(state, args, true).cardRef }));
}
export function lookupRuntimeCardReference(state, args) {
  return envelope(() => ({ identity: { ...lookupInput(state, args, false).identity } }));
}

// Validate the complete scope once, then resolve only within this detached read.
export function createRuntimeReferenceLookup(inputState, inputFrame, viewerSeat) {
  return envelope(() => {
    const state = stateData(inputState);
    const frame = frameData(inputFrame);
    scope(state, frame, INVALID_REF);
    if (!state.seatIds.includes(viewerSeat)) reject(INVALID_REF);
    const tracked = tracking(frame);
    const rows = state.entries.filter(entry => entry.viewerSeat === viewerSeat);
    const byId = new Map(rows.map(entry => [entry.identity.instanceId, entry]));
    const byRef = new Map(rows.map(entry => [entry.cardRef, entry]));
    const available = entry => {
      const card = entry && tracked.cards.get(entry.identity.instanceId);
      return card && tracked.trackable(card, viewerSeat);
    };
    return Object.freeze({
      find(identity) {
        if (identity?.matchId !== state.matchId) return null;
        const entry = byId.get(identity.instanceId);
        return available(entry) ? entry.cardRef : null;
      },
      lookup(cardRef) {
        const entry = byRef.get(cardRef);
        return available(entry) ? { ...entry.identity } : null;
      }
    });
  });
}
