import { CARD_LIBRARY } from '../../data/cards.js';
import { buildIdentityIndex } from './identity.js';

const INVALID = 'RUNTIME_INVALID_BRIDGE_INPUT';
const ALIAS = 'RUNTIME_ALIAS_MISMATCH';
const PHASE = 'RUNTIME_PHASE_MISMATCH';
const UNSUPPORTED = 'RUNTIME_UNSUPPORTED_STORAGE';
const MISSING = Symbol('missing');
const nonempty = value => typeof value === 'string' && value.length > 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
class BridgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const reject = code => { throw new BridgeError(code); };

function ordinary(input, code = INVALID) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) reject(code);
}

function own(input, name, { optional = false, code = INVALID } = {}) {
  ordinary(input, code);
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  if (!descriptor && optional) return MISSING;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}

function exact(input, names, code = INVALID) {
  ordinary(input, code);
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) reject(code);
  return Object.fromEntries(names.map(name => [name, own(input, name, { code })]));
}

function dense(input, code = INVALID) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(input);
  const length = Object.getOwnPropertyDescriptor(input, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const result = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    result.push(descriptor.value);
  }
  return result;
}

function serial(id) {
  if (typeof id !== 'string' || !id.startsWith('i:')) return null;
  const number = Number(id.slice(2));
  return positive(number) && id === `i:${number}` ? number : null;
}

function seats(input, code) {
  const values = dense(input, code);
  if (values.length !== 2 || !values.every(nonempty) || values[0] === values[1]) reject(code);
  return values;
}

function ledgerData(input) {
  const code = 'INVALID_IDENTITY_STATE';
  const ledger = exact(input, ['matchId', 'seatIds', 'nextSerial', 'retiredIds'], code);
  if (!nonempty(ledger.matchId) || !positive(ledger.nextSerial)) reject(code);
  ledger.seatIds = seats(ledger.seatIds, code);
  ledger.retiredIds = dense(ledger.retiredIds, code);
  let previous = 0;
  for (const id of ledger.retiredIds) {
    const number = serial(id);
    if (number === null || number <= previous || number >= ledger.nextSerial) reject(code);
    previous = number;
  }
  return ledger;
}

function reference(input, code) {
  const ref = exact(input, ['matchId', 'instanceId'], code);
  if (!nonempty(ref.matchId) || serial(ref.instanceId) === null) reject(code);
  return ref;
}

function aliasData(input, context, ledger) {
  const rows = dense(input, ALIAS);
  if (rows.length !== ledger.nextSerial - 1) reject(ALIAS);
  const aliases = new Map();
  const instances = new Set();
  for (const raw of rows) {
    const row = exact(raw, ['uid', 'identity', 'ownerSeat', 'definitionId'], ALIAS);
    const identity = reference(row.identity, ALIAS);
    if (identity.matchId !== context.matchId || serial(identity.instanceId) >= ledger.nextSerial || row.uid !== `rt:${identity.instanceId}` || !context.seatIds.includes(row.ownerSeat) || !nonempty(row.definitionId) || !Object.hasOwn(CARD_LIBRARY, row.definitionId) || aliases.has(row.uid) || instances.has(identity.instanceId)) reject(ALIAS);
    aliases.set(row.uid, { ...row, identity });
    instances.add(identity.instanceId);
  }
  return aliases;
}

function extract(state, context, aliases) {
  const records = [];
  const physical = new Map();
  const controllerSeat = playerId => {
    if (!['player', 'ai'].includes(playerId)) reject(INVALID);
    return context.seatIds[playerId === 'player' ? 0 : 1];
  };
  function cardData(card) {
    ordinary(card);
    const id = own(card, 'id');
    const uid = own(card, 'uid');
    const identity = reference(own(card, 'identity'), INVALID);
    const owner = own(card, 'owner');
    const ownerSeat = own(card, 'ownerSeat');
    if (!nonempty(id) || !nonempty(uid) || !['player', 'ai'].includes(owner) || !nonempty(ownerSeat)) reject(INVALID);
    const alias = aliases.get(uid);
    if (!alias || id !== alias.definitionId || identity.matchId !== alias.identity.matchId || identity.instanceId !== alias.identity.instanceId || ownerSeat !== alias.ownerSeat || ownerSeat !== controllerSeat(owner)) reject(ALIAS);
    return { id, uid, identity, ownerSeat };
  }
  function walk(root, controller, location, storage) {
    const ancestors = new Set();
    const stack = [{ card: root, controller, location, storage }];
    while (stack.length) {
      const frame = stack.pop();
      if (frame.exit) { ancestors.delete(frame.card); continue; }
      if (ancestors.has(frame.card)) reject('MOUNT_CYCLE');
      const card = cardData(frame.card);
      const children = dense(own(frame.card, 'mounted'));
      records.push({ identity: card.identity, ownerSeat: card.ownerSeat, controllerSeat: frame.controller, location: frame.location });
      const occurrences = physical.get(card.uid) ?? [];
      occurrences.push({ card, storage: frame.storage, location: frame.location });
      physical.set(card.uid, occurrences);
      ancestors.add(frame.card);
      stack.push({ card: frame.card, exit: true });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        const role = own(child, 'layerRole', { optional: true });
        if (![MISSING, null, 'code', 'mount', 'layered'].includes(role)) reject(INVALID);
        stack.push({ card: child, controller: frame.controller, storage: 'mounted', location: {
          kind: 'mounted', host: { ...card.identity }, order: index + 1,
          role: ['code', 'mount'].includes(role) ? 'mount' : 'layered'
        } });
      }
    }
  }
  function inflight(card, playerId, storageKey, storage) {
    walk(card, controllerSeat(playerId), { kind: 'inflight', storageKey }, storage);
  }
  function source(row, snapshot, code = PHASE) {
    const card = cardData(snapshot);
    if (own(row, 'sourceUid', { code }) !== card.uid || own(row, 'cardId', { code }) !== card.id) reject(code);
    return card;
  }
  const players = own(state, 'players');
  ordinary(players);
  for (const playerId of ['player', 'ai']) {
    const player = own(players, playerId);
    ordinary(player);
    const seatId = controllerSeat(playerId);
    const user = own(player, 'user');
    ordinary(user);
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) {
      const cards = dense(own(player, zone));
      let limit;
      if (['front', 'back'].includes(zone)) {
        limit = own(user, `${zone}Limit`);
        if (!Number.isSafeInteger(limit) || limit < 0) reject(INVALID);
      }
      for (const card of cards) {
        let location = { kind: 'zone', seatId, zone };
        if (['front', 'back'].includes(zone)) {
          const position = own(card, 'boardSlot');
          if (!positive(position) || position > limit || own(card, 'boardSlotController') !== playerId || own(card, 'boardSlotZone') !== zone) reject(INVALID);
          location = { kind: 'board', seatId, zone, position };
        }
        walk(card, seatId, location, zone);
      }
    }
    if (dense(own(player, 'virtual')).length) reject(UNSUPPORTED);
  }
  const pending = own(state, 'pending');
  if (pending !== null) {
    const type = own(pending, 'type');
    if (type === 'decode-place') {
      const playerId = own(pending, 'playerId', { code: PHASE });
      const cards = dense(own(pending, 'cards', { code: PHASE }), PHASE);
      const queue = dense(own(pending, 'queue', { code: PHASE }), PHASE);
      if (!cards.length || cards.length !== queue.length || new Set(queue).size !== queue.length || own(pending, 'sourceUid', { code: PHASE }) !== queue[0]) reject(PHASE);
      for (let index = 0; index < cards.length; index += 1) {
        if (cardData(cards[index]).uid !== queue[index]) reject(PHASE);
        inflight(cards[index], playerId, `pending.decode-place.cards/${index}`, 'decode');
      }
    }
  }
  const trashMoves = own(state, 'deferredTrashMoves', { optional: true });
  if (trashMoves !== MISSING && trashMoves !== null) {
    for (const [index, move] of dense(trashMoves).entries()) inflight(own(move, 'card'), own(move, 'ownerId'), `deferredTrashMoves/${index}/card`, 'deferredTrash');
  }
  const spellCleanup = own(state, 'deferredSpellCleanup', { optional: true });
  if (spellCleanup !== MISSING && spellCleanup !== null) inflight(own(spellCleanup, 'card'), own(spellCleanup, 'playerId'), 'deferredSpellCleanup/card', 'spellCleanup');

  const declared = dense(own(state, 'declaredEffects'));
  const resolving = own(state, 'resolvingDeclaredEffect');
  const cleanup = own(state, 'deferredDeclaredResponseCleanup');
  let cleanupData = null;
  if (cleanup !== null) {
    ordinary(cleanup, PHASE);
    if (resolving === null || own(resolving, 'kind', { code: PHASE }) !== 'response' || own(resolving, 'status', { code: PHASE }) !== 'resolving') reject(PHASE);
    const started = own(cleanup, 'cleanupStarted', { code: PHASE });
    const done = own(cleanup, 'cleanupDone', { code: PHASE });
    const playerId = own(cleanup, 'playerId', { code: PHASE });
    if (typeof started !== 'boolean' || typeof done !== 'boolean' || done && !started || own(cleanup, 'declaredEffectId', { code: PHASE }) !== own(resolving, 'id', { code: PHASE }) || playerId !== own(resolving, 'playerId', { code: PHASE })) reject(PHASE);
    const card = cardData(own(cleanup, 'card', { code: PHASE }));
    const resolvedCard = source(resolving, own(resolving, 'card', { code: PHASE }));
    if (card.uid !== resolvedCard.uid || card.id !== resolvedCard.id || card.identity.matchId !== resolvedCard.identity.matchId || card.identity.instanceId !== resolvedCard.identity.instanceId) reject(PHASE);
    cleanupData = { started, done, card, playerId };
  }
  function declaration(row, expectedStatus, storageKey) {
    ordinary(row, PHASE);
    const kind = own(row, 'kind', { code: PHASE });
    const status = own(row, 'status', { code: PHASE });
    if (!['script', 'response'].includes(kind)) reject(UNSUPPORTED);
    if (status !== expectedStatus || !nonempty(own(row, 'id', { code: PHASE }))) reject(PHASE);
    const playerId = own(row, 'playerId', { code: PHASE });
    controllerSeat(playerId);
    if (kind === 'script') source(row, own(row, 'sourceSnapshot', { code: PHASE }));
    else {
      const card = own(row, 'card', { code: PHASE });
      source(row, card);
      if (expectedStatus === 'declared' || !cleanupData?.started) inflight(card, playerId, storageKey, 'response');
    }
  }
  for (const [index, row] of declared.entries()) declaration(row, 'declared', `declaredEffects/${index}/card`);
  if (resolving !== null) declaration(resolving, 'resolving', 'resolvingDeclaredEffect/card');
  if (cleanupData?.started) {
    const occurrences = physical.get(cleanupData.card.uid) ?? [];
    if (occurrences.length !== 1 || !['trash', 'ban', 'deferredTrash'].includes(occurrences[0].storage) || cleanupData.done && !['trash', 'ban'].includes(occurrences[0].storage)) reject(PHASE);
  }
  const scriptCleanup = own(state, 'deferredDeclaredScriptCleanup');
  if (scriptCleanup !== null) {
    ordinary(scriptCleanup, PHASE);
    const row = own(scriptCleanup, 'declared', { code: PHASE });
    if (resolving === null || own(resolving, 'kind', { code: PHASE }) !== 'script' || own(row, 'kind', { code: PHASE }) !== 'script' || own(row, 'status', { code: PHASE }) !== 'resolving' || own(row, 'id', { code: PHASE }) !== own(resolving, 'id', { code: PHASE }) || own(row, 'playerId', { code: PHASE }) !== own(resolving, 'playerId', { code: PHASE }) || own(row, 'sourceUid', { code: PHASE }) !== own(resolving, 'sourceUid', { code: PHASE }) || own(row, 'cardId', { code: PHASE }) !== own(resolving, 'cardId', { code: PHASE })) reject(PHASE);
    source(row, own(scriptCleanup, 'source', { code: PHASE }));
  }
  return records;
}

export function buildRuntimeIdentityIndex(engineState) {
  try {
    ordinary(engineState);
    const context = exact(own(engineState, 'runtimeContext'), ['matchId', 'seatIds', 'identityState', 'rngState', 'uidAliases']);
    if (!nonempty(context.matchId)) reject(INVALID);
    context.seatIds = seats(context.seatIds, INVALID);
    const ledger = ledgerData(context.identityState);
    if (context.matchId !== ledger.matchId) reject('MATCH_MISMATCH');
    if (context.seatIds.some((seat, index) => seat !== ledger.seatIds[index])) reject('SEAT_MISMATCH');
    const aliases = aliasData(context.uidAliases, context, ledger);
    return buildIdentityIndex(ledger, extract(engineState, context, aliases));
  } catch (error) {
    if (error instanceof BridgeError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}
