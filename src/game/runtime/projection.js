import { CARD_LIBRARY } from '../../data/cards.js';
import { executionCost } from '../engine.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { findRuntimeCardReference } from './references.js';

const INPUT = 'PROJECTION_INVALID_CONTEXT';
const STATE = 'PROJECTION_INVALID_STATE';
const SCOPE = 'PROJECTION_SCOPE_MISMATCH';
const NOT_READY = 'PROJECTION_REFERENCE_NOT_READY';
const MISSING = Symbol('missing');
const TOKEN = /^r:[0-9a-f]{32}$/;
const INSTANCE = /^i:[1-9][0-9]*$/;
const ZONES = ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban'];
class ProjectionError extends Error { constructor(code) { super(code); this.code = code; } }
const reject = code => { throw new ProjectionError(code); };

function ordinary(value, code = STATE) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}

function own(object, key, optional = false, code = STATE) {
  ordinary(object, code);
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor && optional) return MISSING;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}

function exact(object, names, code = STATE) {
  ordinary(object, code);
  const keys = Reflect.ownKeys(object);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) reject(code);
  return Object.fromEntries(names.map(name => [name, own(object, name, false, code)]));
}

function dense(array, code = STATE) {
  if (array === null || typeof array !== 'object' || Object.getPrototypeOf(array) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(array);
  const length = Object.getOwnPropertyDescriptor(array, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}

function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function finite(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) reject(STATE);
  return value;
}
function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(STATE);
  return value;
}
function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (positive ? 1 : 0)) reject(STATE);
  return value;
}
function text(value) {
  if (typeof value !== 'string') reject(STATE);
  return value;
}
function token(value) { return typeof value === 'string' && TOKEN.test(value); }
function serial(value) {
  if (typeof value !== 'string' || !INSTANCE.test(value)) reject(STATE);
  const number = Number(value.slice(2));
  if (!Number.isSafeInteger(number) || number <= 0 || value !== `i:${number}`) reject(STATE);
  return number;
}

function seatIds(value, code = STATE) {
  const result = dense(value, code);
  if (result.length !== 2 || !result.every(nonempty) || result[0] === result[1]) reject(code);
  return result;
}

function contextData(input) {
  const value = exact(input, ['matchId', 'viewerSeat', 'revision'], INPUT);
  if (!nonempty(value.matchId) || !nonempty(value.viewerSeat) || !Number.isSafeInteger(value.revision)
    || Object.is(value.revision, -0) || value.revision < 0) reject(INPUT);
  return value;
}

function referenceHeader(input) {
  const value = exact(input, ['matchId', 'seatIds', 'issuedRefs', 'entries'], STATE);
  if (!nonempty(value.matchId)) reject(STATE);
  value.seatIds = seatIds(value.seatIds);
  return value;
}

function copyIdentity(input) {
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

function copyLocation(input) {
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

function readIdentity(card) { return copyIdentity(own(card, 'identity')); }

function playerId(seats, seat) {
  const index = seats.indexOf(seat);
  if (index < 0) reject(SCOPE);
  return index === 0 ? 'player' : 'ai';
}

function resolvePhysical(engineState, entries, entry, seats) {
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

function frameFor(engineState, built, seats) {
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

function definition(id) {
  if (typeof id !== 'string' || !Object.hasOwn(CARD_LIBRARY, id)) reject(STATE);
  const source = CARD_LIBRARY[id];
  const result = { id };
  for (const key of ['name', 'category', 'text']) result[key] = text(own(source, key));
  const printed = own(source, 'printedCategory', true);
  if (printed !== MISSING && printed !== null) result.printedCategory = text(printed);
  else result.printedCategory = result.category;
  const color = own(source, 'color', true);
  result.color = color === MISSING || color === null ? null : text(color);
  for (const key of ['cost', 'atk', 'str']) {
    const value = own(source, key, true);
    result[key] = value === MISSING || value === null ? null : finite(value);
  }
  const classes = own(source, 'classes', true);
  result.classes = classes === MISSING ? [] : dense(classes).map(text);
  return result;
}

function cardForCost(card) {
  const result = {};
  for (const key of ['id', 'name', 'category']) result[key] = text(own(card, key));
  const printed = own(card, 'printedCategory', true);
  if (printed !== MISSING && printed !== null) result.printedCategory = text(printed);
  const color = own(card, 'color', true);
  if (color !== MISSING && color !== null && color !== undefined) result.color = text(color);
  for (const key of ['cost', 'turnCostModifier', 'costReductionThisTurn', 'revealedExecutionCost']) {
    const value = own(card, key, true);
    if (value !== MISSING && value !== null && value !== undefined) result[key] = number(value);
  }
  const classes = own(card, 'classes', true);
  if (classes !== MISSING && classes !== null && classes !== undefined) result.classes = dense(classes).map(text);
  const faceDown = own(card, 'faceDown', true);
  if (faceDown !== MISSING && faceDown !== null && faceDown !== undefined) {
    if (typeof faceDown !== 'boolean') reject(STATE);
    result.faceDown = faceDown;
  } else result.faceDown = false;
  return result;
}

function cardRefFor(referenceState, frame, context, card) {
  const result = findRuntimeCardReference(referenceState, {
    frame, matchId: context.matchId, viewerSeat: context.viewerSeat, identity: card.identity
  });
  if (!result.ok) {
    if (['REF_MAPPING_MISSING', 'REF_INVALID_REFERENCE'].includes(result.error.code)) reject(NOT_READY);
    if (result.error.code === 'REF_INVALID_FRAME' || result.error.code === 'REF_INVALID_STATE') reject(STATE);
    reject(STATE);
  }
  if (!result.value || !token(result.value.cardRef)) reject(STATE);
  return result.value.cardRef;
}

function safeCurrentCost(engineState, seats, viewerSeat, card) {
  const viewer = playerId(seats, viewerSeat);
  const target = cardForCost(card);
  const statePlayers = {};
  const enginePlayers = own(engineState, 'players');
  for (const id of ['player', 'ai']) {
    const source = own(enginePlayers, id);
    const sourceSeat = seats[id === 'player' ? 0 : 1];
    const user = own(source, 'user');
    const abilityKey = own(user, 'abilityKey');
    if (typeof abilityKey !== 'string') reject(STATE);
    const firstOb = own(source, 'firstObExecutionTurn', true);
    if (firstOb !== MISSING && firstOb !== null && !Number.isSafeInteger(firstOb)) reject(STATE);
    const player = {
      user: { abilityKey }, firstObExecutionTurn: firstOb === MISSING ? null : firstOb,
      front: [], back: [], registry: [], trash: []
    };
    for (const zone of ['front', 'back', 'registry', 'trash']) {
      const includeHidden = sourceSeat === viewerSeat && ['front', 'back'].includes(zone);
      for (const item of dense(own(source, zone))) {
        if (zone === 'trash') {
          if (sourceSeat === viewerSeat) player.trash.push({ name: text(own(item, 'name')) });
          continue;
        }
        const faceDown = own(item, 'faceDown', true);
        if (faceDown !== MISSING && faceDown !== null && faceDown !== undefined && typeof faceDown !== 'boolean') reject(STATE);
        if (faceDown === true && !includeHidden) continue;
        player[zone].push(cardForCost(item));
      }
    }
    statePlayers[id] = player;
  }
  const turnNumber = integer(own(engineState, 'turnNumber'), true);
  const value = executionCost(target, { turnNumber, players: statePlayers }, viewer);
  finite(value);
  return value;
}

function copyPublicLocation(entry, refForIdentity) {
  const location = entry.location;
  if (location.kind === 'board') return { kind: 'board', seatId: location.seatId, zone: location.zone, position: location.position };
  if (location.kind === 'zone') return { kind: 'zone', seatId: location.seatId, zone: location.zone };
  if (location.kind === 'mounted') {
    const hostRef = refForIdentity(location.host.instanceId);
    return { kind: 'mounted', hostRef, role: location.role };
  }
  reject(STATE);
}

function cardValue(engineState, referenceState, context, frame, entry, card, refForIdentity) {
  const cardRef = refForIdentity(entry.identity.instanceId);
  const mounted = [];
  const children = frame.cards.filter(child => child.location.kind === 'mounted'
    && child.location.host.instanceId === entry.identity.instanceId)
    .sort((a, b) => a.location.order - b.location.order);
  const entryMap = new Map(frame.cards.map(item => [item.identity.instanceId, item]));
  for (const child of children) {
    if (child.faceDown) continue;
    const physical = resolvePhysical(engineState, entryMap,
      { identity: child.identity, location: child.location }, frame.seatIds);
    const value = cardValue(engineState, referenceState, context, frame, child, physical, refForIdentity);
    mounted.push(value);
  }
  return {
    cardRef, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
    location: copyPublicLocation(entry, refForIdentity), definition: definition(own(card, 'id')),
    faceDown: false, publicCounters: {}, mounted
  };
}

function mapReferenceScope(referenceState, frame) {
  const header = referenceHeader(referenceState);
  if (header.matchId !== frame.matchId || header.seatIds.some((seat, index) => seat !== frame.seatIds[index])) reject(SCOPE);
  validateReferenceState(header);
  return header;
}

function envelope(action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof ProjectionError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function projectRuntimeView(engineState, referenceState, contextInput) {
  return envelope(() => {
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

    const built = buildRuntimeIdentityIndex(engineState);
    if (!built.ok) reject(STATE);
    if (built.value.matchId !== context.matchId) reject(STATE);
    const frame = frameFor(engineState, built, seats);
    const references = mapReferenceScope(referenceState, frame);
    const byId = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
    const entries = new Map(built.value.entries.map(entry => [entry.identity.instanceId, entry]));
    const cardRefs = new Map();
    const refForIdentity = instanceId => {
      if (cardRefs.has(instanceId)) return cardRefs.get(instanceId);
      const frameCard = byId.get(instanceId);
      if (!frameCard) reject(STATE);
      const value = cardRefFor(references, frame, context, frameCard);
      cardRefs.set(instanceId, value);
      return value;
    };
    const statePlayers = own(engineState, 'players');
    const active = own(engineState, 'active');
    if (!['player', 'ai'].includes(active)) reject(STATE);
    const turnNumber = integer(own(engineState, 'turnNumber'), true);
    const outputSeats = [];
    for (let seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
      const seat = seats[seatIndex];
      const id = seatIndex === 0 ? 'player' : 'ai';
      const player = own(statePlayers, id);
      const zones = Object.fromEntries(ZONES.map(zone => [zone, dense(own(player, zone))]));
      const handOwn = seat === context.viewerSeat;
      const hand = handOwn ? {
        count: zones.hand.length,
        cards: zones.hand.map(card => ({
          cardRef: refForIdentity(readIdentity(card).instanceId),
          definition: definition(own(card, 'id')),
          currentCost: safeCurrentCost(engineState, seats, context.viewerSeat, card)
        }))
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
          return cardValue(engineState, references, context, frame, entry, physical, refForIdentity);
        });
      };
      const faceUpZoneCards = zone => zones[zone].flatMap(card => {
        const faceDown = own(card, 'faceDown', true);
        if (faceDown !== MISSING && faceDown !== null && faceDown !== undefined && typeof faceDown !== 'boolean') reject(STATE);
        if (faceDown === true) return [];
        const identity = readIdentity(card);
        const entry = entries.get(identity.instanceId);
        if (!entry || entry.location.kind !== 'zone' || entry.location.seatId !== seat || entry.location.zone !== zone) reject(STATE);
        return [cardValue(engineState, references, context, frame, entry, card, refForIdentity)];
      });
      const fortress = finite(own(player, 'fortressStr'));
      const memory = finite(own(player, 'memory'));
      outputSeats.push({
        seatId: seat, fortressStr: fortress, memory: { current: memory }, deck: { count: zones.deck.length }, hand,
        front: { cards: boardCards('front') }, back: { cards: boardCards('back') },
        registry: { count: zones.registry.length, cards: faceUpZoneCards('registry') },
        trash: { count: zones.trash.length, cards: faceUpZoneCards('trash') },
        ban: { count: zones.ban.length, cards: faceUpZoneCards('ban') }
      });
    }
    return {
      matchId: context.matchId, revision: context.revision, viewerSeat: context.viewerSeat,
      activeSeat: seats[active === 'player' ? 0 : 1], turnNumber, seats: outputSeats
    };
  });
}
