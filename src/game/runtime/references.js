import { findIdentityEntry } from './identity.js';

const INPUT = 'REF_INVALID_INPUT';
const STATE = 'REF_INVALID_STATE';
const FRAME = 'REF_INVALID_FRAME';
const TRANSITION = 'REF_INVALID_TRANSITION';
const INVALID_REF = 'REF_INVALID_REFERENCE';
const nonempty = value => typeof value === 'string' && value.length > 0;
const token = value => typeof value === 'string' && /^r:[0-9a-f]{32}$/.test(value);
class ReferenceError extends Error { constructor(code) { super(code); this.code = code; } }
const reject = code => { throw new ReferenceError(code); };
function exact(input, names, code) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) reject(code);
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) reject(code);
  return Object.fromEntries(names.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return [name, descriptor.value];
  }));
}
function dense(input, code) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(input);
  const length = Object.getOwnPropertyDescriptor(input, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}
function identity(input, code) {
  const value = exact(input, ['matchId', 'instanceId'], code);
  if (!nonempty(value.matchId) || typeof value.instanceId !== 'string') reject(code);
  const serial = Number(value.instanceId.slice(2));
  if (!Number.isSafeInteger(serial) || serial <= 0 || value.instanceId !== `i:${serial}`) reject(code);
  return value;
}
function seats(input, code) {
  const value = dense(input, code);
  if (value.length !== 2 || !value.every(nonempty) || value[0] === value[1]) reject(code);
  return value;
}
function location(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) reject(FRAME);
  const descriptor = Object.getOwnPropertyDescriptor(input, 'kind');
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(FRAME);
  const layouts = {
    zone: ['kind', 'seatId', 'zone'], board: ['kind', 'seatId', 'zone', 'position'],
    mounted: ['kind', 'host', 'order', 'role'], inflight: ['kind', 'storageKey']
  };
  if (typeof descriptor.value !== 'string' || !Object.hasOwn(layouts, descriptor.value)) reject(FRAME);
  const result = exact(input, layouts[descriptor.value], FRAME);
  if (result.kind === 'mounted') result.host = identity(result.host, FRAME);
  return result;
}
function frameData(input) {
  const frame = exact(input, ['matchId', 'seatIds', 'cards'], FRAME);
  if (!nonempty(frame.matchId)) reject(FRAME);
  frame.seatIds = seats(frame.seatIds, FRAME);
  frame.cards = dense(frame.cards, FRAME).map(inputCard => {
    const card = exact(inputCard, ['identity', 'ownerSeat', 'controllerSeat', 'location', 'faceDown'], FRAME);
    card.identity = identity(card.identity, FRAME);
    card.location = location(card.location);
    if (card.identity.matchId !== frame.matchId || !frame.seatIds.includes(card.ownerSeat) || !frame.seatIds.includes(card.controllerSeat) || typeof card.faceDown !== 'boolean') reject(FRAME);
    if (['zone', 'board'].includes(card.location.kind) && !frame.seatIds.includes(card.location.seatId)) reject(FRAME);
    return card;
  });
  const entries = frame.cards.map(({ identity: ref, ownerSeat, controllerSeat, location: loc }) => ({ identity: ref, ownerSeat, controllerSeat, location: loc }));
  const index = { matchId: frame.matchId, entries };
  if (!findIdentityEntry(index, { matchId: frame.matchId, instanceId: 'i:1' }).ok) reject(FRAME);
  return frame;
}
function stateData(input) {
  const state = exact(input, ['matchId', 'seatIds', 'issuedRefs', 'entries'], STATE);
  if (!nonempty(state.matchId)) reject(STATE);
  state.seatIds = seats(state.seatIds, STATE);
  state.issuedRefs = dense(state.issuedRefs, STATE);
  if (!state.issuedRefs.every(token) || new Set(state.issuedRefs).size !== state.issuedRefs.length) reject(STATE);
  const issued = new Set(state.issuedRefs);
  const active = new Set();
  const pairs = new Map();
  state.entries = dense(state.entries, STATE).map(inputEntry => {
    const entry = exact(inputEntry, ['viewerSeat', 'identity', 'cardRef'], STATE);
    entry.identity = identity(entry.identity, STATE);
    if (!state.seatIds.includes(entry.viewerSeat) || entry.identity.matchId !== state.matchId || !token(entry.cardRef) || !issued.has(entry.cardRef) || active.has(entry.cardRef)) reject(STATE);
    const viewerPairs = pairs.get(entry.viewerSeat) ?? new Set();
    if (viewerPairs.has(entry.identity.instanceId)) reject(STATE);
    viewerPairs.add(entry.identity.instanceId);
    pairs.set(entry.viewerSeat, viewerPairs);
    active.add(entry.cardRef);
    return entry;
  });
  return state;
}
function scope(state, frame, code = FRAME) {
  if (state.matchId !== frame.matchId || state.seatIds.some((seat, index) => seat !== frame.seatIds[index])) reject(code);
}
function tracking(frame) {
  const cards = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
  const memo = new Map();
  function rootTrackable(card, viewer) {
    const loc = card.location;
    if (loc.kind === 'board') return true;
    if (loc.kind === 'zone') return loc.zone === 'hand' ? card.controllerSeat === viewer : ['registry', 'trash', 'ban'].includes(loc.zone) && !card.faceDown;
    return false;
  }
  function trackable(card, viewer) {
    if (card.location.kind !== 'mounted') return rootTrackable(card, viewer);
    let current = card;
    const path = [];
    let result;
    while (current.location.kind === 'mounted') {
      const key = current.identity.instanceId;
      const known = memo.get(viewer)?.get(key);
      if (known !== undefined) { result = known; break; }
      path.push(current);
      if (current.faceDown) { result = false; break; }
      current = cards.get(current.location.host.instanceId);
    }
    if (result === undefined) result = !current.faceDown && rootTrackable(current, viewer);
    const viewerMemo = memo.get(viewer) ?? new Map();
    for (const item of path) viewerMemo.set(item.identity.instanceId, result);
    memo.set(viewer, viewerMemo);
    return result;
  }
  return { cards, trackable };
}
function newTokens(input) {
  const result = dense(input, INPUT);
  if (!result.every(token)) reject(INPUT);
  return result;
}
function allocate(state, frame, trackingState, supplied) {
  const missing = [];
  const mapped = new Map(state.seatIds.map(seat => [seat, new Set(state.entries.filter(entry => entry.viewerSeat === seat).map(entry => entry.identity.instanceId))]));
  for (const card of frame.cards) for (const viewerSeat of frame.seatIds) {
    if (trackingState.trackable(card, viewerSeat) && !mapped.get(viewerSeat).has(card.identity.instanceId)) missing.push({ viewerSeat, identity: { ...card.identity } });
  }
  if (supplied.length !== missing.length) reject(TRANSITION);
  const issued = new Set(state.issuedRefs);
  for (const cardRef of supplied) {
    if (issued.has(cardRef)) reject('REF_COLLISION');
    issued.add(cardRef);
  }
  return { matchId: state.matchId, seatIds: [...state.seatIds], issuedRefs: [...state.issuedRefs, ...supplied], entries: [
    ...state.entries.map(entry => ({ viewerSeat: entry.viewerSeat, identity: { ...entry.identity }, cardRef: entry.cardRef })),
    ...missing.map((entry, index) => ({ ...entry, cardRef: supplied[index] }))
  ] };
}
function pairKey(viewerSeat, instanceId) { return JSON.stringify([viewerSeat, instanceId]); }
function trackablePairs(frame, tracked) {
  const pairs = new Set();
  for (const card of frame.cards) for (const viewerSeat of frame.seatIds) {
    if (tracked.trackable(card, viewerSeat)) pairs.add(pairKey(viewerSeat, card.identity.instanceId));
  }
  return pairs;
}
function transitionPlan(inputState, beforeInput, afterInput) {
  const state = stateData(inputState);
  const beforeFrame = frameData(beforeInput);
  const afterFrame = frameData(afterInput);
  scope(state, beforeFrame);
  scope(state, afterFrame);
  const beforeTracking = tracking(beforeFrame);
  const afterTracking = tracking(afterFrame);
  const beforePairs = trackablePairs(beforeFrame, beforeTracking);
  const activePairs = new Set(state.entries.map(entry => pairKey(entry.viewerSeat, entry.identity.instanceId)));
  if (beforePairs.size !== activePairs.size || [...beforePairs].some(pair => !activePairs.has(pair))) reject(TRANSITION);

  const afterById = new Map(afterFrame.cards.map(card => [card.identity.instanceId, card]));
  const invalidated = [];
  for (const card of [...beforeFrame.cards].sort((a, b) => Number(a.identity.instanceId.slice(2)) - Number(b.identity.instanceId.slice(2)))) {
    const next = afterById.get(card.identity.instanceId);
    if (!next && beforeFrame.seatIds.some(viewer => beforeTracking.trackable(card, viewer))) {
      invalidated.push({ ...card.identity });
      continue;
    }
    if (beforeFrame.seatIds.some(viewer => beforeTracking.trackable(card, viewer) && (!next || !afterTracking.trackable(next, viewer)))) {
      invalidated.push({ ...card.identity });
    }
  }
  const invalidIds = new Set(invalidated.map(identity => identity.instanceId));
  const afterPairs = trackablePairs(afterFrame, afterTracking);
  const retainedPairs = new Set(state.entries
    .filter(entry => !invalidIds.has(entry.identity.instanceId) && afterPairs.has(pairKey(entry.viewerSeat, entry.identity.instanceId)))
    .map(entry => pairKey(entry.viewerSeat, entry.identity.instanceId)));
  let newRefCount = 0;
  for (const pair of afterPairs) if (!retainedPairs.has(pair)) newRefCount += 1;
  return { beforeFrame, afterFrame, invalidated, newRefCount };
}
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
