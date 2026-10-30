import { INPUT, TRANSITION, dense, reject, token } from './guards.js';
import { frameData, scope, stateData, tracking } from './frame-state.js';

export function newTokens(input) {
  const result = dense(input, INPUT);
  if (!result.every(token)) reject(INPUT);
  return result;
}
export function allocate(state, frame, trackingState, supplied) {
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
export function transitionPlan(inputState, beforeInput, afterInput) {
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
