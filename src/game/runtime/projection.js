import { executionCost } from '../engine.js';
import { createRuntimeReadContext, runtimeReadIdentityIndex } from './read-context.js';
import { queryRuntimeRead } from './query.js';
import { createRuntimeReferenceLookup } from './references.js';
import { cardForCost, safeCostView } from './projection/cost-view.js';
import { cardValue, publicDynamics } from './projection/card-value.js';
import { INPUT, MISSING, NOT_READY, PUBLIC_KEYWORDS, ProjectionError, SCOPE, STATE, ZONES, dense, finite, integer, nonempty, own, ordinary, reject, seatIds, token } from './projection/guards.js';
import { frameFor, playerId, resolvePhysical } from './projection/physical-frame.js';
import { contextData, mapReferenceScope, readIdentity, referenceHeader } from './projection/reference-scope.js';
import { publicUser } from './projection/seat-user.js';

function envelope(action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof ProjectionError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

// Without a read context the call makes its own: the identity index is built once for the whole read.
export function projectRuntimeView(engineState, referenceState, contextInput, suppliedContext = null) {
  return envelope(() => {
    const readContext = suppliedContext ?? createRuntimeReadContext(engineState);
    const context = contextData(contextInput);
    ordinary(engineState);
    const runtime = own(engineState, 'runtimeContext');
    ordinary(runtime);
    const matchId = own(runtime, 'matchId');
    if (!nonempty(matchId)) reject(STATE);
    const seats = seatIds(own(runtime, 'seatIds'));
    const referenceMeta = referenceHeader(referenceState);
    if (matchId !== context.matchId || referenceMeta.matchId !== context.matchId
      || seats.some((seat, index) => seat !== referenceMeta.seatIds[index])
      || !seats.includes(context.viewerSeat)) reject(SCOPE);

    const built = runtimeReadIdentityIndex(engineState, readContext);
    if (!built.ok) reject(STATE);
    if (built.value.matchId !== context.matchId) reject(STATE);
    const frame = frameFor(engineState, built, seats);
    const references = mapReferenceScope(referenceState, frame);
    const referenceLookup = createRuntimeReferenceLookup(references, frame, context.viewerSeat);
    if (!referenceLookup.ok) reject(STATE);
    const byId = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
    const entries = new Map(built.value.entries.map(entry => [entry.identity.instanceId, entry]));
    const visibleIdentities = references.entries
      .filter(row => row.viewerSeat === context.viewerSeat && !byId.get(row.identity.instanceId)?.faceDown)
      .map(row => ({ ...row.identity }));
    const dynamicBatch = queryRuntimeRead(engineState, {
      identities: visibleIdentities, keywordNames: [...PUBLIC_KEYWORDS]
    }, readContext);
    if (!dynamicBatch.ok) reject(STATE);
    const dynamicsById = new Map(dynamicBatch.value.cards.map(value => [value.identity.instanceId, value]));
    const cardRefs = new Map();
    const refForIdentity = instanceId => {
      if (cardRefs.has(instanceId)) return cardRefs.get(instanceId);
      const frameCard = byId.get(instanceId);
      if (!frameCard) reject(STATE);
      const value = referenceLookup.value.find(frameCard.identity);
      if (!value) reject(NOT_READY);
      cardRefs.set(instanceId, value);
      return value;
    };
    const statePlayers = own(engineState, 'players');
    const costView = safeCostView(engineState, seats, context.viewerSeat);
    const viewer = playerId(seats, context.viewerSeat);
    const active = own(engineState, 'active');
    if (!['player', 'ai'].includes(active)) reject(STATE);
    const turnNumber = integer(own(engineState, 'turnNumber'), true);
    const outputSeats = [];
    for (let seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
      const seat = seats[seatIndex];
      const id = seatIndex === 0 ? 'player' : 'ai';
      const player = own(statePlayers, id);
      const seatSummary = dynamicBatch.value.seats.find(value => value.seatId === seat);
      if (!seatSummary) reject(STATE);
      const zones = Object.fromEntries(ZONES.map(zone => [zone, dense(own(player, zone))]));
      const handOwn = seat === context.viewerSeat;
      const hand = handOwn ? {
        count: zones.hand.length,
        cards: zones.hand.map(card => {
          const identity = readIdentity(card);
          const entry = entries.get(identity.instanceId);
          if (!entry || entry.location.kind !== 'zone' || entry.location.zone !== 'hand'
            || entry.location.seatId !== seat) reject(STATE);
          const value = cardValue(engineState, references, context, frame, entry, card, refForIdentity, dynamicsById);
          if (value.computed.currentCost !== finite(executionCost(cardForCost(card), costView, viewer))) reject(STATE);
          return value;
        })
      } : { count: zones.hand.length };
      const boardCards = zone => {
        const roots = frame.cards.filter(card => card.location.kind === 'board' && card.location.seatId === seat && card.location.zone === zone);
        roots.sort((a, b) => a.location.position - b.location.position);
        return roots.map(entry => {
          if (entry.faceDown) return {
            cardRef: refForIdentity(entry.identity.instanceId), controllerSeat: entry.controllerSeat,
            area: zone, slot: entry.location.position, faceDown: true, placementOrder: null, publicCounters: {}
          };
          const physical = resolvePhysical(engineState, entries, entries.get(entry.identity.instanceId), seats);
          return cardValue(engineState, references, context, frame, entry, physical, refForIdentity, dynamicsById);
        });
      };
      const faceUpZoneCards = zone => zones[zone].flatMap(card => {
        const faceDown = own(card, 'faceDown', true);
        if (faceDown !== MISSING && faceDown !== null && faceDown !== undefined && typeof faceDown !== 'boolean') reject(STATE);
        if (faceDown === true) return [];
        const identity = readIdentity(card);
        const entry = entries.get(identity.instanceId);
        if (!entry || entry.location.kind !== 'zone' || entry.location.seatId !== seat || entry.location.zone !== zone) reject(STATE);
        return [cardValue(engineState, references, context, frame, entry, card, refForIdentity, dynamicsById)];
      });
      outputSeats.push({
        seatId: seat, user: publicUser(player), fortressStr: seatSummary.fortressStr,
        memory: { ...seatSummary.memory }, enabledSymbols: [...seatSummary.enabledSymbols],
        deck: { count: zones.deck.length }, hand,
        front: { cards: boardCards('front') }, back: { cards: boardCards('back') },
        registry: { count: zones.registry.length, cards: faceUpZoneCards('registry') },
        trash: { count: zones.trash.length, cards: faceUpZoneCards('trash') },
        ban: { count: zones.ban.length, cards: faceUpZoneCards('ban') },
        incidents: dense(own(player,'incidentsTriggered')).map(value => finite(value)),
        turboActive: own(player,'turboActive',true) === true,
        abilityStatus: {turboUsed:own(player,'turboUsed') === true,mulligansUsed:integer(own(player,'mulligansUsed')),
          backup:own(player,'backup',true) === MISSING ? 0 : integer(own(player,'backup')),
          protect:own(player,'protect',true) === MISSING ? 0 : integer(own(player,'protect'))},
        turnsTaken:own(player,'turnsTaken',true) === MISSING ? 0 : integer(own(player,'turnsTaken'))
      });
    }
    return {
      matchId: context.matchId, revision: context.revision, viewerSeat: context.viewerSeat,
      activeSeat: seats[active === 'player' ? 0 : 1], turnNumber, seats: outputSeats
    };
  });
}

export function inspectRuntimeCard(engineState,referenceState,contextInput,cardRef,suppliedContext = null) {
  return envelope(() => {
    const readContext = suppliedContext ?? createRuntimeReadContext(engineState);
    if (!token(cardRef)) reject(INPUT);
    const context = contextData(contextInput), built = runtimeReadIdentityIndex(engineState,readContext);
    if (!built.ok) reject(STATE);
    const seats = seatIds(own(own(engineState,'runtimeContext'),'seatIds'));
    if (built.value.matchId !== context.matchId || !seats.includes(context.viewerSeat)) reject(SCOPE);
    const frame = frameFor(engineState,built,seats), references = mapReferenceScope(referenceState,frame);
    const lookup = createRuntimeReferenceLookup(references,frame,context.viewerSeat);
    if (!lookup.ok) reject(STATE);
    const identity = lookup.value.lookup(cardRef);
    const entry = identity && built.value.entries.find(item => item.identity.instanceId === identity.instanceId);
    if (!entry || entry.controllerSeat !== context.viewerSeat || entry.location.kind === 'inflight') reject(SCOPE);
    const read = queryRuntimeRead(engineState,{identities:[identity],keywordNames:[...PUBLIC_KEYWORDS]},readContext);
    if (!read.ok) reject(STATE);
    const value = read.value.cards[0], dynamics = publicDynamics(new Map([[identity.instanceId,value]]),entry);
    return {matchId:context.matchId,revision:context.revision,viewerSeat:context.viewerSeat,cardRef,
      definition:structuredClone(value.definition),status:dynamics.status,computed:dynamics.computed};
  });
}
