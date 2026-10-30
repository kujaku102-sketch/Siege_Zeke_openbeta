import { buildRuntimeIdentityIndex } from '../bridge.js';
import { planRuntimeReferenceTransition } from '../references.js';
import { queryRuntimeSeat, queryRuntimeCard } from '../query.js';
import { projectRuntimeView } from '../projection.js';
import { tutorialAiDeckId, tutorialPlayerDeckId } from '../tutorial-setup.js';
import { INVALID, MISSING, NOT_READY, SCOPE, STATE, UNSUPPORTED, dense, own, reject, sameArray } from './guards.js';

function effectiveDeck(options) { return options.mode === 'tutorial' ? tutorialPlayerDeckId(options.tutorialId, options.playerDeckId) : options.playerDeckId; }
function effectiveAiDeck(options) { return options.mode === 'tutorial' ? tutorialAiDeckId(options.tutorialId, options.aiDeckId) : options.aiDeckId; }

export function consistency(metadata, state, revision) {
  const runtime = state.runtimeContext;
  if (!Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) reject(INVALID);
  if (runtime.matchId !== metadata.matchId || !sameArray(runtime.seatIds, metadata.seatIds)) reject(SCOPE);
  if (state.mode !== metadata.startOptions.mode || state.tutorialId !== metadata.startOptions.tutorialId
    || state.playerDeckId !== effectiveDeck(metadata.startOptions) || state.aiDeckId !== effectiveAiDeck(metadata.startOptions)
    || state.playerUserId !== metadata.startOptions.playerUserId || state.aiUserId !== metadata.startOptions.aiUserId) reject(STATE);
}

function physicalCards(state) {
  const found = new Map();
  const visit = card => {
    const identity = own(card, 'identity', UNSUPPORTED);
    const id = own(identity, 'instanceId', UNSUPPORTED);
    found.set(id, card);
    for (const child of dense(own(card, 'mounted', UNSUPPORTED), UNSUPPORTED)) visit(child);
  };
  const players = own(state, 'players', UNSUPPORTED);
  for (const owner of ['player', 'ai']) {
    const player = own(players, owner, UNSUPPORTED);
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban', 'virtual']) {
      const value = own(player, zone, UNSUPPORTED, true);
      if (value !== MISSING) for (const card of dense(value, UNSUPPORTED)) visit(card);
    }
  }
  return found;
}

export function checkRuntime(state, references, metadata, revision) {
  consistency(metadata, state, revision);
  const built = buildRuntimeIdentityIndex(state);
  if (!built.ok) reject(STATE);
  const physical = physicalCards(state);
  const frame = {
    matchId: built.value.matchId,
    seatIds: [...metadata.seatIds],
    cards: built.value.entries.map(entry => {
      const card = physical.get(entry.identity.instanceId);
      if (!card) reject(STATE);
      const faceDown = own(card, 'faceDown', STATE, true);
      if (faceDown !== MISSING && typeof faceDown !== 'boolean') reject(STATE);
      return { ...entry, faceDown: faceDown === true };
    })
  };
  const plan = planRuntimeReferenceTransition(references, { beforeFrame: frame, afterFrame: frame });
  if (!plan.ok) {
    if (plan.error.code === 'REF_INVALID_TRANSITION') reject(NOT_READY);
    if (plan.error.code === 'REF_INVALID_FRAME') reject(SCOPE);
    reject(STATE);
  }
  if (plan.value.invalidatedIdentities.length || plan.value.newRefCount) reject(NOT_READY);
  for (const seatId of metadata.seatIds) if (!queryRuntimeSeat(state, { seatId }).ok) reject(STATE);
  for (const entry of built.value.entries.slice(0, 1)) {
    if (!queryRuntimeCard(state, { identity: entry.identity, keywordNames: [] }).ok) reject(STATE);
  }
  for (const viewerSeat of metadata.seatIds) {
    const result = projectRuntimeView(state, references, { matchId: metadata.matchId, viewerSeat, revision });
    if (!result.ok && result.error.code === 'PROJECTION_SCOPE_MISMATCH') reject(SCOPE);
    if (!result.ok) reject(result.error.code === 'PROJECTION_REFERENCE_NOT_READY' ? NOT_READY : STATE);
  }
}
