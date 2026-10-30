import { STATE, dense, own, playerId, reject } from './guards.js';

// The validated index chooses storage. This resolver does not discover or repair it.
export function resolvePhysical(state, entries, entry, seats) {
  const chain = [];
  while (entry.location.kind === 'mounted') {
    chain.push(entry.location.order);
    entry = entries.get(entry.location.host.instanceId);
    if (!entry) reject(STATE);
  }
  const location = entry.location;
  let card;
  if (location.kind === 'zone' || location.kind === 'board') {
    const player = own(own(state, 'players'), playerId(seats, location.seatId));
    card = dense(own(player, location.zone)).find(candidate => own(own(candidate, 'identity'), 'instanceId') === entry.identity.instanceId);
  } else {
    const key = location.storageKey;
    let match;
    if ((match = /^pending\.decode-place\.cards\/(0|[1-9]\d*)$/.exec(key))) card = dense(own(own(state, 'pending'), 'cards'))[Number(match[1])];
    else if ((match = /^deferredTrashMoves\/(0|[1-9]\d*)\/card$/.exec(key))) card = own(dense(own(state, 'deferredTrashMoves'))[Number(match[1])], 'card');
    else if ((match = /^declaredEffects\/(0|[1-9]\d*)\/card$/.exec(key))) card = own(dense(own(state, 'declaredEffects'))[Number(match[1])], 'card');
    else if (key === 'deferredSpellCleanup/card') card = own(own(state, 'deferredSpellCleanup'), 'card');
    else if (key === 'resolvingDeclaredEffect/card') card = own(own(state, 'resolvingDeclaredEffect'), 'card');
    else reject(STATE);
  }
  if (!card) reject(STATE);
  while (chain.length) {
    card = dense(own(card, 'mounted'))[chain.pop() - 1];
    if (!card) reject(STATE);
  }
  return card;
}
