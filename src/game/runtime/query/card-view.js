import { CARD_LIBRARY } from '../../../data/cards.js';
import { MISSING, STATE, booleanField, dense, integer, number, ordinary, own, reject, strings } from './guards.js';

export function definition(id) {
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
export function cardState(card) {
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
export function componentView(original) {
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
