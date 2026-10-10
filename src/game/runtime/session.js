import { CARD_LIBRARY, USER_CARDS } from '../../data/cards.js';
import { createGame, DECK_OPTIONS } from '../engine.js';
import { createIdentityState } from './identity.js';
import { createRngState } from './rng.js';
import { RuntimeError } from './factory.js';
import { buildRuntimeIdentityIndex } from './bridge.js';

const failure = code => ({ ok: false, error: { code } });
const nonempty = value => typeof value === 'string' && value.length > 0;
const defaults = {
  mode: 'ai', tutorialId: 'basics', playerDeckId: 'red', aiDeckId: 'yellow',
  playerDeckRecipe: null, aiDeckRecipe: null, playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
};

function fields(input, names, subset = false) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  if (!subset && keys.length !== names.length) return null;
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

function recipe(input) {
  if (input === null) return null;
  const rows = dense(input);
  if (!rows) return false;
  let total = 0;
  const result = [];
  for (const row of rows) {
    const pair = dense(row);
    if (!pair || pair.length !== 2 || typeof pair[0] !== 'string' || !Object.hasOwn(CARD_LIBRARY, pair[0]) || !Number.isSafeInteger(pair[1]) || pair[1] <= 0) return false;
    total += pair[1];
    if (!Number.isSafeInteger(total)) return false;
    result.push(pair);
  }
  return result;
}

function options(input) {
  const supplied = fields(input, Object.keys(defaults), true);
  if (!supplied || Object.values(supplied).some(value => value === undefined)) return null;
  const normalized = { ...defaults, ...supplied };
  if (!['ai', 'tutorial', 'lab', 'sandbox'].includes(normalized.mode) || !['basics', 'vengeance'].includes(normalized.tutorialId)) return null;
  for (const key of ['playerDeckId', 'aiDeckId']) if (typeof normalized[key] !== 'string' || !Object.hasOwn(DECK_OPTIONS, normalized[key])) return null;
  for (const key of ['playerUserId', 'aiUserId']) if (typeof normalized[key] !== 'string' || !Object.hasOwn(USER_CARDS, normalized[key])) return null;
  if (typeof normalized.sandboxDeckSetup !== 'boolean') return null;
  for (const key of ['playerDeckRecipe', 'aiDeckRecipe']) {
    const copied = recipe(normalized[key]);
    if (copied === false) return null;
    normalized[key] = copied;
  }
  if (normalized.mode === 'tutorial') {
    const vengeance = normalized.tutorialId === 'vengeance';
    const playerRecipe = normalized.playerDeckRecipe ?? DECK_OPTIONS[vengeance ? 'vengeance' : normalized.playerDeckId].recipe;
    const aiRecipe = normalized.aiDeckRecipe ?? DECK_OPTIONS[normalized.aiDeckId].recipe;
    const contains = (rows, ids) => ids.every(id => rows.some(([definition, count]) => definition === id && count > 0));
    if (!vengeance && !contains(playerRecipe, ['STD-076', 'STD-075', 'STD-090', 'STD-086'])) return null;
    if (!contains(aiRecipe, vengeance ? ['STD-125', 'STD-131', 'STD-149'] : ['STD-125', 'STD-131', 'STD-149', 'STD-129', 'STD-138'])) return null;
  }
  return normalized;
}

export function createRuntimeSession(input) {
  const config = fields(input, ['matchId', 'seatIds', 'seed', 'ruleVersion', 'cardVersion', 'gameOptions']);
  if (!config || !nonempty(config.matchId) || !nonempty(config.ruleVersion) || !nonempty(config.cardVersion)) return failure('RUNTIME_INVALID_CONFIG');
  const seatIds = dense(config.seatIds);
  if (!seatIds || seatIds.length !== 2 || !seatIds.every(nonempty) || seatIds[0] === seatIds[1]) return failure('RUNTIME_INVALID_CONFIG');
  const startOptions = options(config.gameOptions);
  if (!startOptions) return failure('RUNTIME_INVALID_CONFIG');
  const rng = createRngState({ seed: config.seed });
  if (!rng.ok) return rng;
  const identity = createIdentityState({ matchId: config.matchId, seatIds });
  if (!identity.ok) return failure(identity.error.code);
  const runtimeContext = { matchId: config.matchId, seatIds: [...seatIds], identityState: identity.value, rngState: rng.value, uidAliases: [] };
  try {
    const engineState = createGame({ ...startOptions, runtimeContext });
    const index = buildRuntimeIdentityIndex(engineState);
    if (!index.ok) return failure(index.error.code);
    return { ok: true, value: {
      metadata: { matchId: config.matchId, seatIds: [...seatIds], ruleVersion: config.ruleVersion, cardVersion: config.cardVersion, startOptions },
      revision: 0,
      engineState
    } };
  } catch (error) {
    if (error instanceof RuntimeError) return failure(error.code);
    throw error;
  }
}
