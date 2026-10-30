import { getMaxMemory, enabledSymbols, executionCost, cardAtk, cardMaxStr, cardCurrentStr, cardHasKeyword } from '../engine.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { runtimeReadIdentityIndex } from './read-context.js';
import { runtimeComponents } from '../../ui/runtime-components.js';
import { cardState, componentView, definition } from './query/card-view.js';
import { computationView } from './query/computation-view.js';
import { INPUT, QueryError, STATE, ZONES, dense, exact, nonempty, number, own, playerId, ref, reject, strings } from './query/guards.js';
import { resolvePhysical } from './query/physical.js';

function envelope(action) {
  try { return action(); }
  catch (error) {
    if (error instanceof QueryError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function queryRuntimeSeat(engineState, args) {
  return envelope(() => {
    const { seatId } = exact(args, ['seatId']);
    if (!nonempty(seatId)) reject(INPUT);
    const built = buildRuntimeIdentityIndex(engineState);
    if (!built.ok) return built;
    const seats = dense(own(own(engineState, 'runtimeContext'), 'seatIds'));
    const id = playerId(seats, seatId);
    const active = own(engineState, 'active');
    if (!['player', 'ai'].includes(active)) reject(STATE);
    const view = computationView(engineState).state;
    const original = own(own(engineState, 'players'), id);
    const symbols = strings(enabledSymbols(view.players[id]));
    const counts = Object.fromEntries(ZONES.map(zone => [zone, dense(own(original, zone)).length]));
    return { ok: true, value: { matchId: built.value.matchId, seatId, activeSeat: seats[active === 'player' ? 0 : 1],
      turnNumber: view.turnNumber, fortressStr: number(own(original, 'fortressStr')),
      memory: { current: number(own(original, 'memory')), max: number(getMaxMemory(view.players[id])) },
      turboActive: view.players[id].turboActive, enabledSymbols: symbols, counts } };
  });
}

function runtimeCardBatch(engineState, identities, names, shared = null) {
  if (!names.every(nonempty) || new Set(names).size !== names.length) reject(INPUT);
  if (new Set(identities.map(identity => identity.instanceId)).size !== identities.length) reject(INPUT);
  const built = shared?.built ?? buildRuntimeIdentityIndex(engineState);
  if (!built.ok) return built;
  if (identities.some(identity => identity.matchId !== built.value.matchId)) reject('MATCH_MISMATCH');
  const entries = new Map(built.value.entries.map(entry => [entry.identity.instanceId, entry]));
  const seats = dense(own(own(engineState, 'runtimeContext'), 'seatIds'));
  const view = shared?.view ?? computationView(engineState);
  const values = identities.map(identity => {
    const entry = entries.get(identity.instanceId);
    if (!entry) reject('UNKNOWN_INSTANCE');
    const original = resolvePhysical(engineState, entries, entry, seats);
    const physicalIdentity = own(original, 'identity');
    if (own(physicalIdentity, 'matchId') !== identity.matchId || own(physicalIdentity, 'instanceId') !== identity.instanceId) reject(STATE);
    const card = view.copyCard(original);
    const controller = playerId(seats, entry.controllerSeat);
    const cost = number(executionCost(card, view.state, controller));
    if (cost < 0) reject(STATE);
    const keywords = names.map(name => {
      const enabled = cardHasKeyword(view.state, controller, card, name);
      if (typeof enabled !== 'boolean') reject(STATE);
      return { name, enabled };
    });
    return { identity: { ...entry.identity }, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
      location: entry.location, definition: definition(own(original, 'id')), state: cardState(original), computed: {
        executionCost: cost, atk: number(cardAtk(view.state, controller, card)), maxStr: number(cardMaxStr(view.state, controller, card)),
        currentStr: number(cardCurrentStr(view.state, controller, card)), keywords,
        components: runtimeComponents(componentView(original),view.state.turnNumber).map(({label,value,note,abilityName,tone}) => ({label,value,note,abilityName,tone}))
      } };
  });
  return { ok: true, value: values };
}

export function queryRuntimeCards(engineState, args) {
  return envelope(() => {
    const input = exact(args, ['identities', 'keywordNames']);
    const identities = dense(input.identities, INPUT).map(identity => ref(identity));
    const names = strings(input.keywordNames, INPUT);
    return runtimeCardBatch(engineState, identities, names);
  });
}

export function queryRuntimeLocations(engineState) {
  return envelope(() => {
    const built = buildRuntimeIdentityIndex(engineState);
    if (!built.ok) return built;
    const seats = dense(own(own(engineState, 'runtimeContext'), 'seatIds'));
    const entries = new Map(built.value.entries.map(entry => [entry.identity.instanceId, entry]));
    const cards = built.value.entries.map(entry => {
      const physical = resolvePhysical(engineState, entries, entry, seats);
      const faceDown = own(physical, 'faceDown');
      if (typeof faceDown !== 'boolean') reject(STATE);
      return { identity: { ...entry.identity }, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
        location: entry.location.kind === 'mounted' ? { ...entry.location, host: { ...entry.location.host } } : { ...entry.location }, faceDown };
    });
    return { ok: true, value: { matchId: built.value.matchId, seatIds: [...seats], cards } };
  });
}

export function queryRuntimeRead(engineState, args, readContext = null) {
  return envelope(() => {
    const input = exact(args, ['identities', 'keywordNames']);
    const identities = dense(input.identities, INPUT).map(identity => ref(identity));
    const names = strings(input.keywordNames, INPUT);
    const built = runtimeReadIdentityIndex(engineState, readContext);
    if (!built.ok) return built;
    const view = computationView(engineState);
    const cards = runtimeCardBatch(engineState, identities, names, { built, view });
    if (!cards.ok) return cards;
    const seatIds = dense(own(own(engineState, 'runtimeContext'), 'seatIds'));
    const seats = seatIds.map((seatId, index) => {
      const id = index === 0 ? 'player' : 'ai';
      const original = own(own(engineState, 'players'), id);
      return { seatId, fortressStr: number(own(original, 'fortressStr')),
        memory: { current: number(own(original, 'memory')), max: number(getMaxMemory(view.state.players[id])) },
        enabledSymbols: strings(enabledSymbols(view.state.players[id])) };
    });
    return { ok: true, value: { cards: cards.value, seats } };
  });
}

export function queryRuntimeCard(engineState, args) {
  return envelope(() => {
    const input = exact(args, ['identity', 'keywordNames']);
    const identity = ref(input.identity);
    const names = strings(input.keywordNames, INPUT);
    const result = runtimeCardBatch(engineState, [identity], names);
    return result.ok ? { ok: true, value: result.value[0] } : result;
  });
}
