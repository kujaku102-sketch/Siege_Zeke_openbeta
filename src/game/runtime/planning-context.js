import { createRuntimeReferenceLookup } from './references.js';
import { runtimePlanningReads } from './command-bridge.js';
import { runtimeReadIdentityIndex } from './read-context.js';

export function createPlanningContext(authority, viewerSeat, readContext = null, allowTutorial = false) {
  const metadata = runtimePlanningReads.metadataData(authority.metadata);
  if (!metadata.seatIds.includes(viewerSeat)) throw new Error('PLANNING_SCOPE_MISMATCH');
  const engine = runtimePlanningReads.engineData(authority.engineState, metadata);
  const playerId = metadata.seatIds[0] === viewerSeat ? 'player' : 'ai';
  const allowed = (engine.mode !== 'tutorial' || allowTutorial) && !engine.hasResult && !engine.busy && engine.active === playerId;
  if (!allowed) return { metadata, revision: authority.revision, engine, playerId, viewerSeat, allowed };
  const built = runtimeReadIdentityIndex(authority.engineState, readContext);
  if (!built.ok) throw new Error(built.error.code);
  const cards = runtimePlanningReads.physicalCardMap(authority.engineState);
  const byUid = new Map([...cards.values()].map(card => [card.uid, card]));
  const entries = new Map(built.value.entries.map(entry => [entry.identity.instanceId, entry]));
  const frame = { matchId: metadata.matchId, seatIds: metadata.seatIds, cards: built.value.entries.map(entry => ({
    identity: entry.identity, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
    location: entry.location, faceDown: cards.get(entry.identity.instanceId)?.faceDown
  })) };
  const refs = createRuntimeReferenceLookup(authority.referenceState, frame, viewerSeat);
  if (!refs.ok) throw new Error(refs.error.code);
  const views = new Map();
  return {
    metadata, revision: authority.revision, engine, playerId, viewerSeat, state: authority.engineState,
    allowed,
    refFor(card) { return refs.value.find(card.identity ?? byUid.get(card.uid)?.identity); },
    resolve(cardRef) {
      const identity = refs.value.lookup(cardRef);
      return identity ? { card: cards.get(identity.instanceId), entry: entries.get(identity.instanceId) } : null;
    },
    view(name) {
      if (!views.has(name)) views.set(name, runtimePlanningReads[`${name}PlanningView`](authority.engineState));
      return views.get(name);
    }
  };
}
