import { buildRuntimeIdentityIndex } from '../bridge.js';
import { findIdentityEntry } from '../identity.js';
import { lookupRuntimeCardReference } from '../references.js';
import { sameSeats, seatIds } from './authority-data.js';
import { dense, exact, nonempty, ordinary, own, reject } from './common.js';

const REF_TOKEN = /^r:[0-9a-f]{32}$/;
const IDENTITY_TOKEN = /^i:[1-9]\d*$/;

function runtimeReferenceState(value, metadata) {
  const state = exact(value, ['matchId', 'seatIds', 'issuedRefs', 'entries'], 'INVALID_AUTHORITY');
  if (!nonempty(state.matchId) || state.matchId !== metadata.matchId || !sameSeats(seatIds(state.seatIds), metadata.seatIds)) reject('INVALID_AUTHORITY');
  const issuedRefs = dense(state.issuedRefs, 'INVALID_AUTHORITY');
  if (!issuedRefs.every(token => typeof token === 'string' && token.length === 34 && REF_TOKEN.test(token))
    || new Set(issuedRefs).size !== issuedRefs.length) reject('INVALID_AUTHORITY');
  const issued = new Set(issuedRefs);
  const seenRefs = new Set();
  const seenPairs = new Set();
  const entries = dense(state.entries, 'INVALID_AUTHORITY').map(valueEntry => {
    const entry = exact(valueEntry, ['viewerSeat', 'identity', 'cardRef'], 'INVALID_AUTHORITY');
    const identity = exact(entry.identity, ['matchId', 'instanceId'], 'INVALID_AUTHORITY');
    if (!nonempty(identity.matchId) || identity.matchId !== state.matchId || typeof identity.instanceId !== 'string'
      || !IDENTITY_TOKEN.test(identity.instanceId) || !Number.isSafeInteger(Number(identity.instanceId.slice(2)))
      || identity.instanceId !== `i:${Number(identity.instanceId.slice(2))}` || !state.seatIds.includes(entry.viewerSeat)
      || typeof entry.cardRef !== 'string' || entry.cardRef.length !== 34 || !REF_TOKEN.test(entry.cardRef)
      || !issued.has(entry.cardRef) || seenRefs.has(entry.cardRef)) reject('INVALID_AUTHORITY');
    const pair = JSON.stringify([entry.viewerSeat, identity.instanceId]);
    if (seenPairs.has(pair)) reject('INVALID_AUTHORITY');
    seenRefs.add(entry.cardRef);
    seenPairs.add(pair);
    return { viewerSeat: entry.viewerSeat, identity, cardRef: entry.cardRef };
  });
  return { matchId: state.matchId, seatIds: [...state.seatIds], issuedRefs, entries };
}

export function physicalCardMap(engineState) {
  const players = own(engineState, 'players', 'INVALID_AUTHORITY');
  ordinary(players, 'INVALID_AUTHORITY');
  const cards = new Map();
  for (const playerId of ['player', 'ai']) {
    const player = own(players, playerId, 'INVALID_AUTHORITY');
    ordinary(player, 'INVALID_AUTHORITY');
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) {
      for (const root of dense(own(player, zone, 'INVALID_AUTHORITY'), 'INVALID_AUTHORITY')) {
        const stack = [root];
        while (stack.length) {
          const card = stack.pop();
          ordinary(card, 'INVALID_AUTHORITY');
          const identity = exact(own(card, 'identity', 'INVALID_AUTHORITY'), ['matchId', 'instanceId'], 'INVALID_AUTHORITY');
          if (!nonempty(identity.matchId) || !nonempty(identity.instanceId) || cards.has(identity.instanceId)) reject('INVALID_AUTHORITY');
          cards.set(identity.instanceId, card);
          stack.push(...dense(own(card, 'mounted', 'INVALID_AUTHORITY'), 'INVALID_AUTHORITY'));
        }
      }
    }
  }
  return cards;
}

export function currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const refs = runtimeReferenceState(referenceInput, metadata);
  const built = buildRuntimeIdentityIndex(engineState);
  if (!built.ok) reject('INVALID_AUTHORITY');
  const cards = physicalCardMap(engineState);
  const frameCards = built.value.entries.map(entry => {
    const card = cards.get(entry.identity.instanceId);
    if (!card) reject('INVALID_AUTHORITY');
    const faceDown = own(card, 'faceDown', 'INVALID_AUTHORITY');
    if (typeof faceDown !== 'boolean') reject('INVALID_AUTHORITY');
    return {
      identity: { ...entry.identity }, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
      location: entry.location.kind === 'mounted'
        ? { ...entry.location, host: { ...entry.location.host } } : { ...entry.location }, faceDown
    };
  });
  const frame = { matchId: built.value.matchId, seatIds: [...metadata.seatIds], cards: frameCards };
  const found = lookupRuntimeCardReference(refs, {
    frame, matchId: metadata.matchId, viewerSeat: actorSeat, cardRef
  });
  if (!found.ok) {
    if (found.error.code === 'REF_INVALID_REFERENCE') reject('ACTION_NOT_ALLOWED');
    reject('INVALID_AUTHORITY');
  }
  const indexed = findIdentityEntry(built.value, found.value.identity);
  if (!indexed.ok || !indexed.value) reject('INVALID_AUTHORITY');
  const entry = indexed.value;
  const instanceId = entry.identity.instanceId;
  const card = cards.get(instanceId);
  if (!card) reject('INVALID_AUTHORITY');
  const uid = own(card, 'uid', 'INVALID_AUTHORITY');
  const rawIdentity = exact(own(card, 'identity', 'INVALID_AUTHORITY'), ['matchId', 'instanceId'], 'INVALID_AUTHORITY');
  if (uid !== `rt:${instanceId}` || rawIdentity.matchId !== entry.identity.matchId || rawIdentity.instanceId !== instanceId) reject('INVALID_AUTHORITY');
  if (!stateOwnerRegistered(entry.ownerSeat, metadata.seatIds)) reject('INVALID_AUTHORITY');
  return { entry, card, uid };
}

function stateOwnerRegistered(ownerSeat, seats) { return seats.includes(ownerSeat); }
