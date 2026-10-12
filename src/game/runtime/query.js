import { CARD_LIBRARY } from '../../data/cards.js';
import { getMaxMemory, enabledSymbols, executionCost, cardAtk, cardMaxStr, cardCurrentStr, cardHasKeyword } from '../engine.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { runtimeReadIdentityIndex } from './read-context.js';
import { runtimeComponents } from '../../ui/runtime-components.js';

const INPUT = 'RUNTIME_INVALID_QUERY_INPUT';
const STATE = 'RUNTIME_INVALID_QUERY_STATE';
const MISSING = Symbol('missing');
const ZONES = ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban'];
const nonempty = value => typeof value === 'string' && value.length > 0;
class QueryError extends Error { constructor(code) { super(code); this.code = code; } }
const reject = code => { throw new QueryError(code); };
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
function exact(object, keys, code = INPUT) {
  ordinary(object, code);
  const names = Reflect.ownKeys(object);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) reject(code);
  return Object.fromEntries(keys.map(key => [key, own(object, key, false, code)]));
}
function dense(array, code = STATE) {
  if (array === null || typeof array !== 'object' || Object.getPrototypeOf(array) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(array);
  const length = Object.getOwnPropertyDescriptor(array, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}
function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject(STATE);
  return value;
}
function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (positive ? 1 : 0)) reject(STATE);
  return value;
}
function booleanField(object, key) {
  const value = own(object, key, true);
  if (value === MISSING) return false;
  if (typeof value !== 'boolean') reject(STATE);
  return value;
}
function strings(value, code = STATE) {
  const result = dense(value, code);
  if (!result.every(item => typeof item === 'string')) reject(code);
  return result;
}
function ref(input) {
  const result = exact(input, ['matchId', 'instanceId']);
  if (!nonempty(result.matchId) || typeof result.instanceId !== 'string') reject(INPUT);
  const serial = Number(result.instanceId.slice(2));
  if (!Number.isSafeInteger(serial) || serial <= 0 || result.instanceId !== `i:${serial}`) reject(INPUT);
  return result;
}
function playerId(seats, seat) {
  const position = seats.indexOf(seat);
  if (position < 0) reject('SEAT_MISMATCH');
  return position === 0 ? 'player' : 'ai';
}

// The validated index chooses storage. This resolver does not discover or repair it.
function resolvePhysical(state, entries, entry, seats) {
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

function computationView(state) {
  const copies = new Map();
  function copyCard(original) {
    if (copies.has(original)) return copies.get(original);
    ordinary(original);
    const result = {};
    copies.set(original, result);
    for (const key of ['id', 'uid', 'name', 'category']) {
      const value = own(original, key);
      if (typeof value !== 'string') reject(STATE);
      result[key] = value;
    }
    for (const key of ['printedCategory', 'color', 'text']) {
      const value = own(original, key, true);
      if (value !== MISSING && value !== null && value !== undefined) {
        if (typeof value !== 'string') reject(STATE);
        result[key] = value;
      }
    }
    for (const key of ['cost', 'atk', 'str', 'damage', 'tempAtk', 'tempStr', 'permanentAtk', 'permanentStr', 'battleStrBonus', 'load', 'turnCostModifier', 'costReductionThisTurn', 'revealedExecutionCost']) {
      const value = own(original, key, true);
      if (value !== MISSING && value !== null && value !== undefined) result[key] = number(value);
    }
    result.damage ??= 0;
    for (const key of ['faceDown', 'protectConsumed']) {
      const value = own(original, key, true);
      if (value !== MISSING && value !== null && value !== undefined) {
        if (typeof value !== 'boolean') reject(STATE);
        result[key] = value;
      }
    }
    for (const key of ['classes', 'grantedKeywords']) {
      const value = own(original, key, true);
      if (value !== MISSING && value !== null && value !== undefined) result[key] = strings(value);
    }
    const compiled = own(original, 'compiled', true);
    if (compiled !== MISSING && compiled !== null && compiled !== undefined) {
      result.compiled = { keywords: dense(own(compiled, 'keywords')).map(keyword => {
        const name = own(keyword, 'name');
        if (typeof name !== 'string') reject(STATE);
        const row = { name };
        const intrinsic = own(keyword, 'intrinsic', true);
        if (intrinsic !== MISSING) {
          if (typeof intrinsic !== 'boolean') reject(STATE);
          row.intrinsic = intrinsic;
        }
        return row;
      }) };
    }
    const timed = own(original, 'timedModifiers', true);
    if (timed !== MISSING && timed !== null && timed !== undefined) {
      result.timedModifiers = dense(timed).map(modifier => {
        const expiresAfterTurn = own(modifier, 'expiresAfterTurn');
        if (!Number.isSafeInteger(expiresAfterTurn)) reject(STATE);
        const row = { expiresAfterTurn };
        for (const key of ['atk', 'str']) {
          const value = own(modifier, key, true);
          if (value !== MISSING && value !== null && value !== undefined) row[key] = number(value);
        }
        const keyword = own(modifier, 'keyword', true);
        if (keyword !== MISSING && keyword !== null && keyword !== undefined) {
          if (typeof keyword !== 'string') reject(STATE);
          row.keyword = keyword;
        }
        return row;
      });
    }
    result.mounted = dense(own(original, 'mounted')).map(copyCard);
    return result;
  }
  const result = { turnNumber: integer(own(state, 'turnNumber'), true), players: {} };
  const players = own(state, 'players');
  for (const id of ['player', 'ai']) {
    const original = own(players, id);
    const abilityKey = own(own(original, 'user'), 'abilityKey');
    if (typeof abilityKey !== 'string') reject(STATE);
    const first = own(original, 'firstObExecutionTurn');
    if (first !== null && !Number.isSafeInteger(first)) reject(STATE);
    const player = {
      user: { abilityKey }, baseMemory: number(own(original, 'baseMemory')),
      permanentMemory: number(own(original, 'permanentMemory')),
      turboActive: booleanField(original, 'turboActive'), firstObExecutionTurn: first
    };
    for (const zone of ['front', 'back', 'registry', 'trash']) player[zone] = dense(own(original, zone)).map(copyCard);
    result.players[id] = player;
  }
  return { state: result, copyCard };
}
function definition(id) {
  const original = CARD_LIBRARY[id];
  const result = { id };
  for (const key of ['name', 'category', 'text']) {
    const value = own(original, key);
    if (typeof value !== 'string') reject(STATE);
    result[key] = value;
  }
  for (const key of ['printedCategory', 'color']) {
    const value = own(original, key, true);
    if (value !== MISSING && value !== null && typeof value !== 'string') reject(STATE);
    result[key] = value === MISSING || value === null ? key === 'printedCategory' ? result.category : null : value;
  }
  for (const key of ['cost', 'atk', 'str']) {
    const value = own(original, key, true);
    result[key] = value === MISSING || value === null ? null : number(value);
  }
  const classes = own(original, 'classes', true);
  result.classes = classes === MISSING ? [] : strings(classes);
  return { id: result.id, name: result.name, category: result.category, printedCategory: result.printedCategory, color: result.color,
    cost: result.cost, atk: result.atk, str: result.str, text: result.text, classes: result.classes };
}
function cardState(card) {
  const result = {};
  for (const key of ['faceDown', 'sleep', 'summoningSick', 'token', 'virtual', 'residentActive']) result[key] = booleanField(card, key);
  const damage = own(card, 'damage', true);
  result.damage = damage === MISSING ? 0 : number(damage);
  for (const key of ['protect', 'backup', 'load']) {
    const value = own(card, key, true);
    result[key] = value === MISSING ? 0 : integer(value);
  }
  const counters = own(card, 'counters', true);
  result.counters = {};
  if (counters !== MISSING) {
    ordinary(counters);
    for (const key of Reflect.ownKeys(counters)) {
      if (typeof key !== 'string') reject(STATE);
      Object.defineProperty(result.counters, key, { value: integer(own(counters, key)), enumerable: true, writable: true, configurable: true });
    }
  }
  return result;
}
function componentView(original) {
  const result = {};
  for (const key of ['text','backupUsedTurn','backupUsesThisTurn','protect','backup','load','permanentAtk','permanentStr',
    'tempAtk','tempStr','battleStrBonus','turnCostModifier','costReductionThisTurn','revealedExecutionCost']) {
    const value = own(original,key,true);
    if (value !== MISSING && value !== null && value !== undefined) {
      if (key === 'text' ? typeof value !== 'string' : typeof value !== 'number' || !Number.isFinite(value)) reject(STATE);
      result[key] = value;
    }
  }
  const granted = own(original,'grantedKeywords',true);
  result.grantedKeywords = granted === MISSING || granted === null || granted === undefined ? [] : strings(granted);
  for (const list of ['timedModifiers','damageModifiers']) {
    const value = own(original,list,true);
    result[list] = value === MISSING || value === null || value === undefined ? [] : dense(value).map(item => {
      const row = {};
      for (const key of list === 'timedModifiers' ? ['keyword','atk','str','expiresAfterTurn'] : ['activeTurn','damageKind','direction','operation','amount','duration']) {
        const field = own(item,key,true);
        if (field !== MISSING && field !== null && field !== undefined) {
          if (!['string','number'].includes(typeof field) || typeof field === 'number' && !Number.isFinite(field)) reject(STATE);
          row[key] = field;
        }
      }
      return row;
    });
  }
  result.counters = cardState(original).counters;
  const compiled = own(original,'compiled',true);
  result.compiled = {keywords: compiled === MISSING || compiled === null ? [] : dense(own(compiled,'keywords')).map(item => {
    const name = own(item,'name'), value = own(item,'value',true);
    if (typeof name !== 'string' || value !== MISSING && value !== null && !['number','string'].includes(typeof value)) reject(STATE);
    return {name,value:value === MISSING ? null : value};
  })};
  return result;
}
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
