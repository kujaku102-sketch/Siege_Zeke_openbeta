import { CARD_LIBRARY, createCardInstance, createToken, expandDeck } from '../../data/cards.js';
import { allocateInstanceId, createIdentityState } from './identity.js';
import { restoreRngState } from './rng.js';

export class RuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

const invalid = () => { throw new RuntimeError('RUNTIME_INVALID_FACTORY_INPUT'); };
const nonempty = value => typeof value === 'string' && value.length > 0;

function fields(input, names) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length) return null;
  const result = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !names.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function dense(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Array.prototype) return null;
  const keys = Reflect.ownKeys(input);
  const length = Object.getOwnPropertyDescriptor(input, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || keys.length !== length.value + 1) return null;
  const result = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result.push(descriptor.value);
  }
  return result;
}

function recipeData(recipe) {
  const rows = dense(recipe);
  if (!rows) invalid();
  let total = 0;
  return rows.map(row => {
    const pair = dense(row);
    if (!pair || pair.length !== 2 || !nonempty(pair[0]) || !Object.hasOwn(CARD_LIBRARY, pair[0]) || !Number.isSafeInteger(pair[1]) || pair[1] <= 0) invalid();
    total += pair[1];
    if (!Number.isSafeInteger(total)) invalid();
    return pair;
  });
}

function contextData(context, owner) {
  if (!['player', 'ai'].includes(owner)) invalid();
  const data = fields(context, ['matchId', 'seatIds', 'identityState', 'rngState', 'uidAliases']);
  if (!data || !nonempty(data.matchId)) invalid();
  const seats = dense(data.seatIds);
  if (!seats || seats.length !== 2 || !seats.every(nonempty) || seats[0] === seats[1]) invalid();
  const initial = createIdentityState({ matchId: data.matchId, seatIds: seats });
  if (!initial.ok) throw new RuntimeError(initial.error.code);
  const ledger = fields(data.identityState, ['matchId', 'seatIds', 'nextSerial', 'retiredIds']);
  if (!ledger) throw new RuntimeError('INVALID_IDENTITY_STATE');
  const ledgerSeats = dense(ledger.seatIds);
  if (ledger.matchId !== data.matchId || !ledgerSeats || ledgerSeats[0] !== seats[0] || ledgerSeats[1] !== seats[1] || ledgerSeats.length !== 2) invalid();
  const restored = restoreRngState(data.rngState);
  if (!restored.ok) throw new RuntimeError(restored.error.code);
  const aliases = dense(data.uidAliases);
  if (!aliases) invalid();
  const uids = new Set();
  const identities = new Set();
  for (const raw of aliases) {
    const alias = fields(raw, ['uid', 'identity', 'ownerSeat', 'definitionId']);
    const ref = alias && fields(alias.identity, ['matchId', 'instanceId']);
    if (!ref || ref.matchId !== data.matchId || !nonempty(ref.instanceId) || !/^i:[1-9]\d*$/.test(ref.instanceId)) invalid();
    const serial = Number(ref.instanceId.slice(2));
    if (!Number.isSafeInteger(serial) || serial >= ledger.nextSerial || ref.instanceId !== `i:${serial}` || alias.uid !== `rt:${ref.instanceId}` || !seats.includes(alias.ownerSeat) || !nonempty(alias.definitionId) || !Object.hasOwn(CARD_LIBRARY, alias.definitionId) || uids.has(alias.uid) || identities.has(ref.instanceId)) invalid();
    uids.add(alias.uid);
    identities.add(ref.instanceId);
  }
  // Allocation remains responsible for validating the complete identity ledger.
  return { identityState: data.identityState, aliases, ownerSeat: seats[owner === 'player' ? 0 : 1] };
}

function register(raw, data) {
  const allocated = allocateInstanceId(data.identityState);
  if (!allocated.ok) throw new RuntimeError(allocated.error.code);
  const identity = { ...allocated.value.identity };
  const uid = `rt:${identity.instanceId}`;
  const card = { ...raw, uid, identity, ownerSeat: data.ownerSeat };
  const alias = { uid, identity: { ...identity }, ownerSeat: data.ownerSeat, definitionId: raw.id };
  data.identityState = allocated.value.state;
  data.aliases = [...data.aliases, alias];
  return card;
}

function commit(context, data) {
  context.identityState = data.identityState;
  context.uidAliases = data.aliases;
}

export function expandRuntimeDeck(context, recipe, engineOwner) {
  if (context === null) return expandDeck(recipe, engineOwner);
  const data = contextData(context, engineOwner);
  const rows = recipeData(recipe);
  const raw = expandDeck(rows, engineOwner);
  const cards = raw.map(card => register(card, data));
  commit(context, data);
  return cards;
}

export function createRuntimeCard(context, id, owner, legacySerial) {
  if (context === null) return createCardInstance(id, owner, legacySerial);
  const data = contextData(context, owner);
  if (!nonempty(id) || !Object.hasOwn(CARD_LIBRARY, id)) invalid();
  const raw = createCardInstance(id, owner, legacySerial);
  const card = register(raw, data);
  commit(context, data);
  return card;
}

export function createRuntimeToken(context, owner, legacySerial) {
  if (context === null) return createToken(owner, legacySerial);
  const data = contextData(context, owner);
  const raw = createToken(owner, legacySerial);
  const card = register(raw, data);
  commit(context, data);
  return card;
}
