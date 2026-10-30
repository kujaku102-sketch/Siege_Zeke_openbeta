import { MISSING, SCOPE, STATE, dense, own, reject, text } from './guards.js';
import { copyLocation, readIdentity } from './reference-scope.js';

export function playerId(seats, seat) {
  const index = seats.indexOf(seat);
  if (index < 0) reject(SCOPE);
  return index === 0 ? 'player' : 'ai';
}

export function resolvePhysical(engineState, entries, entry, seats) {
  let current = entry;
  const ancestors = [];
  while (current.location.kind === 'mounted') {
    ancestors.push(current.location.order);
    current = entries.get(current.location.host.instanceId);
    if (!current) reject(STATE);
  }
  const location = current.location;
  let card;
  if (location.kind === 'zone' || location.kind === 'board') {
    const player = own(own(engineState, 'players'), playerId(seats, location.seatId));
    card = dense(own(player, location.zone)).find(item => {
      const identity = readIdentity(item);
      return identity.matchId === current.identity.matchId && identity.instanceId === current.identity.instanceId;
    });
  } else if (location.kind === 'inflight') {
    let match;
    const key = location.storageKey;
    if ((match = /^pending\.decode-place\.cards\/(0|[1-9][0-9]*)$/.exec(key))) {
      card = dense(own(own(engineState, 'pending'), 'cards'))[Number(match[1])];
    } else if ((match = /^deferredTrashMoves\/(0|[1-9][0-9]*)\/card$/.exec(key))) {
      card = own(dense(own(engineState, 'deferredTrashMoves'))[Number(match[1])], 'card');
    } else if ((match = /^declaredEffects\/(0|[1-9][0-9]*)\/card$/.exec(key))) {
      card = own(dense(own(engineState, 'declaredEffects'))[Number(match[1])], 'card');
    } else if (key === 'deferredSpellCleanup/card') card = own(own(engineState, 'deferredSpellCleanup'), 'card');
    else if (key === 'resolvingDeclaredEffect/card') card = own(own(engineState, 'resolvingDeclaredEffect'), 'card');
    else reject(STATE);
  } else reject(STATE);
  if (!card) reject(STATE);
  if (ancestors.length) {
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
      card = dense(own(card, 'mounted'))[ancestors[index] - 1];
      if (!card) reject(STATE);
    }
  }
  const identity = readIdentity(card);
  if (identity.matchId !== entry.identity.matchId || identity.instanceId !== entry.identity.instanceId) reject(STATE);
  return card;
}

export function frameFor(engineState, built, seats) {
  const entries = new Map(built.value.entries.map(entry => [entry.identity.instanceId, entry]));
  const cards = built.value.entries.map(entry => {
    const physical = resolvePhysical(engineState, entries, entry, seats);
    const faceDown = own(physical, 'faceDown', true);
    if (faceDown !== MISSING && typeof faceDown !== 'boolean') reject(STATE);
    return {
      identity: { ...entry.identity }, ownerSeat: text(entry.ownerSeat), controllerSeat: text(entry.controllerSeat),
      location: copyLocation(entry.location), faceDown: faceDown === true
    };
  });
  return { matchId: built.value.matchId, seatIds: [...seats], cards };
}
