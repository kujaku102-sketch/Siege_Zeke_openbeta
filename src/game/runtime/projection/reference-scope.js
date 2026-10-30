import { INPUT, SCOPE, STATE, ZONES, dense, exact, integer, nonempty, own, reject, seatIds, serial, token } from './guards.js';

export function contextData(input) {
  const value = exact(input, ['matchId', 'viewerSeat', 'revision'], INPUT);
  if (!nonempty(value.matchId) || !nonempty(value.viewerSeat) || !Number.isSafeInteger(value.revision)
    || Object.is(value.revision, -0) || value.revision < 0) reject(INPUT);
  return value;
}

export function referenceHeader(input) {
  const value = exact(input, ['matchId', 'seatIds', 'issuedRefs', 'entries'], STATE);
  if (!nonempty(value.matchId)) reject(STATE);
  value.seatIds = seatIds(value.seatIds);
  return value;
}

export function copyIdentity(input) {
  const value = exact(input, ['matchId', 'instanceId'], STATE);
  if (!nonempty(value.matchId)) reject(STATE);
  serial(value.instanceId);
  return { matchId: value.matchId, instanceId: value.instanceId };
}

function validateReferenceState(header) {
  const refs = dense(header.issuedRefs);
  if (!refs.every(token) || new Set(refs).size !== refs.length) reject(STATE);
  const issued = new Set(refs);
  const activeRefs = new Set();
  const viewerInstances = new Map();
  for (const raw of dense(header.entries)) {
    const entry = exact(raw, ['viewerSeat', 'identity', 'cardRef'], STATE);
    const identity = copyIdentity(entry.identity);
    if (!header.seatIds.includes(entry.viewerSeat) || identity.matchId !== header.matchId
      || !token(entry.cardRef) || !issued.has(entry.cardRef) || activeRefs.has(entry.cardRef)) reject(STATE);
    const seen = viewerInstances.get(entry.viewerSeat) ?? new Set();
    if (seen.has(identity.instanceId)) reject(STATE);
    seen.add(identity.instanceId);
    viewerInstances.set(entry.viewerSeat, seen);
    activeRefs.add(entry.cardRef);
  }
}

export function copyLocation(input) {
  const kind = own(input, 'kind');
  if (kind === 'zone') {
    const value = exact(input, ['kind', 'seatId', 'zone']);
    if (!nonempty(value.seatId) || !ZONES.includes(value.zone)) reject(STATE);
    return value;
  }
  if (kind === 'board') {
    const value = exact(input, ['kind', 'seatId', 'zone', 'position']);
    if (!nonempty(value.seatId) || !['front', 'back'].includes(value.zone)) reject(STATE);
    integer(value.position, true);
    return value;
  }
  if (kind === 'mounted') {
    const value = exact(input, ['kind', 'host', 'order', 'role']);
    value.host = copyIdentity(value.host);
    integer(value.order, true);
    if (!['mount', 'layered'].includes(value.role)) reject(STATE);
    return value;
  }
  if (kind === 'inflight') {
    const value = exact(input, ['kind', 'storageKey']);
    if (!nonempty(value.storageKey)) reject(STATE);
    return value;
  }
  reject(STATE);
}

export function readIdentity(card) { return copyIdentity(own(card, 'identity')); }

export function mapReferenceScope(referenceState, frame) {
  const header = referenceHeader(referenceState);
  if (header.matchId !== frame.matchId || header.seatIds.some((seat, index) => seat !== frame.seatIds[index])) reject(SCOPE);
  validateReferenceState(header);
  return header;
}
