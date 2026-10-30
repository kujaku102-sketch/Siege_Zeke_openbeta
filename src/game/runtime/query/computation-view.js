import { MISSING, STATE, booleanField, dense, integer, number, ordinary, own, reject, strings } from './guards.js';

export function computationView(state) {
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
