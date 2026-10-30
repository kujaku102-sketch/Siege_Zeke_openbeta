import { findIdentityEntry } from '../identity.js';
import { FRAME, STATE, dense, exact, identity, nonempty, reject, seats, token } from './guards.js';

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
export function frameData(input) {
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
export function stateData(input) {
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
export function scope(state, frame, code = FRAME) {
  if (state.matchId !== frame.matchId || state.seatIds.some((seat, index) => seat !== frame.seatIds[index])) reject(code);
}
export function tracking(frame) {
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
