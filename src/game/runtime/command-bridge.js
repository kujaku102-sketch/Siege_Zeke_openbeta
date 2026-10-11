import { canonicalizeCommand, classifyCommand } from './command-record.js';
import { canActivateTurbo, canAddSandboxCardToHand, canAttack, canDirectRelogAtSlot, canExecuteAtSlot, canOpeningMulligan, canPlayLayeredCard, cardHasKeyword, enabledSymbols, getAttackTargets, supportsDirectHandObExecution, supportsNormalScriptActivation } from '../engine.js';
import { isObCard } from '../card-types.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { findIdentityEntry } from './identity.js';
import { lookupRuntimeCardReference } from './references.js';
import { createActionRegistry, lookupActionHandler } from './action-registry.js';
import { prepareRequiredInputAction } from './required-input.js';
import {
  SAFE_READ_MISSING, SafeReadError, readDenseData, readFiniteNumber, readOrdinary, readOwnData
} from './safe-read.js';

const AUTHORITY_KEYS = ['metadata', 'revision', 'engineState', 'journal'];
const REFERENCE_AUTHORITY_KEYS = [...AUTHORITY_KEYS, 'referenceState'];
const METADATA_KEYS = ['matchId', 'seatIds', 'ruleVersion', 'cardVersion', 'startOptions'];
const START_OPTION_KEYS = ['mode', 'tutorialId', 'playerDeckId', 'aiDeckId', 'playerDeckRecipe', 'aiDeckRecipe', 'playerUserId', 'aiUserId', 'sandboxDeckSetup'];
const CONTEXT_KEYS = ['matchId', 'seatIds', 'identityState', 'rngState', 'uidAliases'];
const IDENTITY_KEYS = ['matchId', 'seatIds', 'nextSerial', 'retiredIds'];
const VICTORY_KEYS = ['lockedOutcome', 'lockedAtEffectId', 'finished'];
const REQUIRED_NULL = ['pending', 'prompt', 'effectResolution', 'mandatoryDrawContinuation', 'resolvingDeclaredEffect',
  'deferredDeclaredResponseCleanup', 'deferredDeclaredScriptCleanup', 'placementCostBatch'];
const REQUIRED_EMPTY = ['selectionQueue', 'triggerQueue', 'scriptActivationQueue', 'declaredEffects', 'responseEventQueue', 'victoryFacts'];
const OPTIONAL_NULL_MARKERS = ['deferredAttack', 'deferredDestruction', 'deferredSpellCleanup', 'std230AmbushCleanup'];
const OPTIONAL_BUSY_OBJECTS = ['std142DestroyBatch', 'std211DestructionBatch', 'std094TurnEndQueue', 'std141TurnEndQueue', 'std142TurnEndQueue'];
const OPTIONAL_EMPTY_OBJECTS = ['runtimeDestructionContinuations', 'std142DestructionContinuations', 'std211DestructionContinuations', 'destroyLkiFollowUps'];
const OPTIONAL_EMPTY_ARRAYS = ['deferredTrashMoves', 'independentEffects'];
const OPTIONAL_FLAGS = ['drainingIndependentEffects', 'resolvingStd165', 'skipSavageTurnEnd'];
const OPTIONAL_PLAYER_FLAGS = ['securityRestWindow', 'std094TurnEndDone', 'std141TurnEndDone', 'std142TurnEndDone', 'resumeTurnEndAfterSelection'];
const ATTACK_STAGES = ['start', 'std182-script', 'after-declare', 'after-battle'];
const MISSING = SAFE_READ_MISSING;
const CHOICE_ACTIONS = new Set(['answerChoice', 'declineChoice']);
const nonempty = value => typeof value === 'string' && value.length > 0;
const safeRevision = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

class CommandBridgeError extends Error { constructor(code) { super(code); this.code = code; } }
const reject = code => { throw new CommandBridgeError(code); };

function ordinary(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}

function own(value, key, code, optional = false) {
  ordinary(value, code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return MISSING;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}

function exact(value, keys, code) {
  ordinary(value, code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) reject(code);
  const result = {};
  for (const key of keys) Object.defineProperty(result, key, {
    value: own(value, key, code), enumerable: true, writable: true, configurable: true
  });
  return result;
}

function dense(value, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const result = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    result.push(descriptor.value);
  }
  return result;
}

function seatIds(value) {
  const seats = dense(value, 'INVALID_AUTHORITY');
  if (seats.length !== 2 || !seats.every(nonempty) || seats[0] === seats[1]) reject('INVALID_AUTHORITY');
  return seats;
}

function recipe(value) {
  if (value === null) return null;
  const rows = dense(value, 'INVALID_AUTHORITY');
  let countTotal = 0;
  return rows.map(rowValue => {
    const row = dense(rowValue, 'INVALID_AUTHORITY');
    if (row.length !== 2 || !nonempty(row[0]) || !Number.isSafeInteger(row[1]) || row[1] <= 0 || Object.is(row[1], -0)) reject('INVALID_AUTHORITY');
    countTotal += row[1];
    if (!Number.isSafeInteger(countTotal)) reject('INVALID_AUTHORITY');
    return [row[0], row[1]];
  });
}

function metadataData(value) {
  const metadata = exact(value, METADATA_KEYS, 'INVALID_AUTHORITY');
  if (!nonempty(metadata.matchId) || !nonempty(metadata.ruleVersion) || !nonempty(metadata.cardVersion)) reject('INVALID_AUTHORITY');
  metadata.seatIds = seatIds(metadata.seatIds);
  const options = exact(metadata.startOptions, START_OPTION_KEYS, 'INVALID_AUTHORITY');
  if (!['ai', 'tutorial', 'lab', 'sandbox'].includes(options.mode) || !['basics', 'vengeance'].includes(options.tutorialId)
    || !nonempty(options.playerDeckId) || !nonempty(options.aiDeckId) || !nonempty(options.playerUserId) || !nonempty(options.aiUserId)
    || typeof options.sandboxDeckSetup !== 'boolean') reject('INVALID_AUTHORITY');
  options.playerDeckRecipe = recipe(options.playerDeckRecipe);
  options.aiDeckRecipe = recipe(options.aiDeckRecipe);
  metadata.startOptions = options;
  return metadata;
}

function authorityData(value) {
  return exact(value, AUTHORITY_KEYS, 'INVALID_AUTHORITY');
}

function publicAuthorityHeader(value) {
  ordinary(value, 'INVALID_AUTHORITY');
  const metadata = own(value, 'metadata', 'INVALID_AUTHORITY');
  ordinary(metadata, 'INVALID_AUTHORITY');
  const matchId = own(metadata, 'matchId', 'INVALID_AUTHORITY');
  const seats = seatIds(own(metadata, 'seatIds', 'INVALID_AUTHORITY'));
  if (!nonempty(matchId)) reject('INVALID_AUTHORITY');
  return { matchId, seatIds: seats };
}

function journalAfterAuthorization(value, usesReference) {
  const keys = Reflect.ownKeys(value);
  const expected = usesReference ? REFERENCE_AUTHORITY_KEYS : AUTHORITY_KEYS;
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) reject('INVALID_AUTHORITY');
  return own(value, 'journal', 'INVALID_AUTHORITY');
}

function sameSeats(left, right) { return left.length === right.length && left.every((seat, index) => seat === right[index]); }

function validateRuntimeContext(value, metadata) {
  const context = exact(value, CONTEXT_KEYS, 'INVALID_AUTHORITY');
  if (!nonempty(context.matchId) || context.matchId !== metadata.matchId || !sameSeats(seatIds(context.seatIds), metadata.seatIds)) reject('INVALID_AUTHORITY');
  const identity = exact(context.identityState, IDENTITY_KEYS, 'INVALID_AUTHORITY');
  if (!nonempty(identity.matchId) || identity.matchId !== metadata.matchId || !sameSeats(seatIds(identity.seatIds), metadata.seatIds)
    || !Number.isSafeInteger(identity.nextSerial) || identity.nextSerial < 1 || Object.is(identity.nextSerial, -0)) reject('INVALID_AUTHORITY');
  const retired = dense(identity.retiredIds, 'INVALID_AUTHORITY');
  if (!retired.every(nonempty)) reject('INVALID_AUTHORITY');
  ordinary(context.rngState, 'INVALID_AUTHORITY');
  dense(context.uidAliases, 'INVALID_AUTHORITY');
}

function validateEmptyObject(value) {
  ordinary(value, 'INVALID_AUTHORITY');
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string') reject('INVALID_AUTHORITY');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject('INVALID_AUTHORITY');
  }
  return keys.length === 0;
}

function optionalState(engine, state, restSecurity = false) {
  for (const key of OPTIONAL_NULL_MARKERS) {
    const value = own(engine, key, 'INVALID_AUTHORITY', true);
    if (value === MISSING || value === null) continue;
    ordinary(value, 'INVALID_AUTHORITY');
    state.busy = true;
  }
  for (const key of OPTIONAL_BUSY_OBJECTS) {
    const value = own(engine, key, 'INVALID_AUTHORITY', true);
    if (value === MISSING) continue;
    ordinary(value, 'INVALID_AUTHORITY');
    state.busy = true;
  }
  for (const key of OPTIONAL_EMPTY_OBJECTS) {
    const value = own(engine, key, 'INVALID_AUTHORITY', true);
    if (value === MISSING) continue;
    if (!validateEmptyObject(value)) state.busy = true;
  }
  for (const key of OPTIONAL_EMPTY_ARRAYS) {
    const value = own(engine, key, 'INVALID_AUTHORITY', true);
    if (value === MISSING) continue;
    if (dense(value, 'INVALID_AUTHORITY').length !== 0) state.busy = true;
  }
  for (const key of OPTIONAL_FLAGS) {
    const value = own(engine, key, 'INVALID_AUTHORITY', true);
    if (value === MISSING) continue;
    if (typeof value !== 'boolean') reject('INVALID_AUTHORITY');
    if (value) state.busy = true;
  }
  for (const key of OPTIONAL_PLAYER_FLAGS) {
    const value = own(engine, key, 'INVALID_AUTHORITY', true);
    if (value === MISSING) continue;
    if (value !== 'player' && value !== 'ai') reject('INVALID_AUTHORITY');
    if (restSecurity && key === 'securityRestWindow') {
      state.securityRestWindow = value;
      continue;
    }
    state.busy = true;
  }
  const attackStage = own(engine, 'attackResumeStage', 'INVALID_AUTHORITY', true);
  if (attackStage !== MISSING) {
    if (!ATTACK_STAGES.includes(attackStage)) reject('INVALID_AUTHORITY');
    state.busy = true;
  }
}

function engineData(value, metadata, restSecurity = false) {
  ordinary(value, 'INVALID_AUTHORITY');
  validateRuntimeContext(own(value, 'runtimeContext', 'INVALID_AUTHORITY'), metadata);
  const options = metadata.startOptions;
  const state = {
    mode: own(value, 'mode', 'INVALID_AUTHORITY'), tutorialId: own(value, 'tutorialId', 'INVALID_AUTHORITY'),
    playerDeckId: own(value, 'playerDeckId', 'INVALID_AUTHORITY'), aiDeckId: own(value, 'aiDeckId', 'INVALID_AUTHORITY'),
    playerUserId: own(value, 'playerUserId', 'INVALID_AUTHORITY'), aiUserId: own(value, 'aiUserId', 'INVALID_AUTHORITY'),
    active: own(value, 'active', 'INVALID_AUTHORITY'), winner: own(value, 'winner', 'INVALID_AUTHORITY'),
    phase: own(value, 'phase', 'INVALID_AUTHORITY'), interactive: own(value, 'interactive', 'INVALID_AUTHORITY'), busy: false
  };
  const expectedPlayerDeck = options.mode === 'tutorial' && options.tutorialId === 'vengeance' ? 'vengeance' : options.playerDeckId;
  if (!['ai', 'tutorial', 'lab', 'sandbox'].includes(state.mode) || state.mode !== options.mode
    || !['basics', 'vengeance'].includes(state.tutorialId) || state.tutorialId !== options.tutorialId
    || !nonempty(state.playerDeckId) || state.playerDeckId !== expectedPlayerDeck || !nonempty(state.aiDeckId) || state.aiDeckId !== options.aiDeckId
    || !nonempty(state.playerUserId) || state.playerUserId !== options.playerUserId
    || !nonempty(state.aiUserId) || state.aiUserId !== options.aiUserId) reject('INVALID_AUTHORITY');
  if (state.active !== 'player' && state.active !== 'ai') reject('INVALID_AUTHORITY');
  if (state.winner !== null && !['player', 'ai', 'draw'].includes(state.winner)) reject('INVALID_AUTHORITY');
  if (!nonempty(state.phase) || typeof state.interactive !== 'boolean') reject('INVALID_AUTHORITY');

  const victory = exact(own(value, 'victory', 'INVALID_AUTHORITY'), VICTORY_KEYS, 'INVALID_AUTHORITY');
  if (victory.lockedOutcome !== null && !['player', 'ai', 'draw'].includes(victory.lockedOutcome)) reject('INVALID_AUTHORITY');
  if (victory.lockedAtEffectId !== null && !nonempty(victory.lockedAtEffectId)) reject('INVALID_AUTHORITY');
  if (typeof victory.finished !== 'boolean') reject('INVALID_AUTHORITY');
  if ((state.winner !== null && victory.lockedOutcome !== null && state.winner !== victory.lockedOutcome)
    || (victory.lockedAtEffectId !== null && victory.lockedOutcome === null)
    || (victory.finished && victory.lockedOutcome === null)) reject('INVALID_AUTHORITY');
  state.hasResult = state.winner !== null || victory.lockedOutcome !== null || victory.finished;

  for (const key of REQUIRED_NULL) {
    const field = own(value, key, 'INVALID_AUTHORITY');
    if (field !== null) {
      ordinary(field, 'INVALID_AUTHORITY');
      state.busy = true;
    }
  }
  for (const key of REQUIRED_EMPTY) {
    if (dense(own(value, key, 'INVALID_AUTHORITY'), 'INVALID_AUTHORITY').length !== 0) state.busy = true;
  }
  for (const key of ['processingTriggers', 'resolvingResponse']) {
    const field = own(value, key, 'INVALID_AUTHORITY');
    if (typeof field !== 'boolean') reject('INVALID_AUTHORITY');
    if (field) state.busy = true;
  }
  const effectDepth = own(value, 'effectDepth', 'INVALID_AUTHORITY');
  if (!Number.isSafeInteger(effectDepth) || effectDepth < 0 || Object.is(effectDepth, -0)) reject('INVALID_AUTHORITY');
  if (effectDepth !== 0) state.busy = true;
  const thread = own(value, 'triggerThread', 'INVALID_AUTHORITY');
  if (thread !== null) {
    ordinary(thread, 'INVALID_AUTHORITY');
    const status = own(thread, 'status', 'INVALID_AUTHORITY');
    if (!nonempty(status)) reject('INVALID_AUTHORITY');
    if (status !== 'resolved') state.busy = true;
  }
  optionalState(value, state, restSecurity);
  if (state.phase !== 'main') state.busy = true;
  return state;
}

function journalSeatOrder(value, metadata) {
  const journal = exact(value, ['schemaVersion', 'matchId', 'seatIds', 'entries'], 'INVALID_AUTHORITY');
  if (journal.schemaVersion !== 1 || journal.matchId !== metadata.matchId || !sameSeats(seatIds(journal.seatIds), metadata.seatIds)) reject('INVALID_AUTHORITY');
}

const REF_TOKEN = /^r:[0-9a-f]{32}$/;
const IDENTITY_TOKEN = /^i:[1-9]\d*$/;

function runtimeReferenceState(value, metadata) {
  const state = exact(value, ['matchId', 'seatIds', 'issuedRefs', 'entries'], 'INVALID_AUTHORITY');
  if (!nonempty(state.matchId) || state.matchId !== metadata.matchId || !sameSeats(seatIds(state.seatIds), metadata.seatIds)) reject('INVALID_AUTHORITY');
  const issuedRefs = dense(state.issuedRefs, 'INVALID_AUTHORITY');
  if (!issuedRefs.every(token => typeof token === 'string' && token.length === 34 && REF_TOKEN.test(token))
    || new Set(issuedRefs).size !== issuedRefs.length) reject('INVALID_AUTHORITY');
  const issued = new Set(issuedRefs);
  const seenRefs = new Set();
  const seenPairs = new Set();
  const entries = dense(state.entries, 'INVALID_AUTHORITY').map(valueEntry => {
    const entry = exact(valueEntry, ['viewerSeat', 'identity', 'cardRef'], 'INVALID_AUTHORITY');
    const identity = exact(entry.identity, ['matchId', 'instanceId'], 'INVALID_AUTHORITY');
    if (!nonempty(identity.matchId) || identity.matchId !== state.matchId || typeof identity.instanceId !== 'string'
      || !IDENTITY_TOKEN.test(identity.instanceId) || !Number.isSafeInteger(Number(identity.instanceId.slice(2)))
      || identity.instanceId !== `i:${Number(identity.instanceId.slice(2))}` || !state.seatIds.includes(entry.viewerSeat)
      || typeof entry.cardRef !== 'string' || entry.cardRef.length !== 34 || !REF_TOKEN.test(entry.cardRef)
      || !issued.has(entry.cardRef) || seenRefs.has(entry.cardRef)) reject('INVALID_AUTHORITY');
    const pair = JSON.stringify([entry.viewerSeat, identity.instanceId]);
    if (seenPairs.has(pair)) reject('INVALID_AUTHORITY');
    seenRefs.add(entry.cardRef);
    seenPairs.add(pair);
    return { viewerSeat: entry.viewerSeat, identity, cardRef: entry.cardRef };
  });
  return { matchId: state.matchId, seatIds: [...state.seatIds], issuedRefs, entries };
}

function physicalCardMap(engineState) {
  const players = own(engineState, 'players', 'INVALID_AUTHORITY');
  ordinary(players, 'INVALID_AUTHORITY');
  const cards = new Map();
  for (const playerId of ['player', 'ai']) {
    const player = own(players, playerId, 'INVALID_AUTHORITY');
    ordinary(player, 'INVALID_AUTHORITY');
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) {
      for (const root of dense(own(player, zone, 'INVALID_AUTHORITY'), 'INVALID_AUTHORITY')) {
        const stack = [root];
        while (stack.length) {
          const card = stack.pop();
          ordinary(card, 'INVALID_AUTHORITY');
          const identity = exact(own(card, 'identity', 'INVALID_AUTHORITY'), ['matchId', 'instanceId'], 'INVALID_AUTHORITY');
          if (!nonempty(identity.matchId) || !nonempty(identity.instanceId) || cards.has(identity.instanceId)) reject('INVALID_AUTHORITY');
          cards.set(identity.instanceId, card);
          stack.push(...dense(own(card, 'mounted', 'INVALID_AUTHORITY'), 'INVALID_AUTHORITY'));
        }
      }
    }
  }
  return cards;
}

const selectedObject = readOrdinary;
const selectedField = readOwnData;
const selectedArray = readDenseData;

function securityEligibilityView(card) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const category = selectedField(card, 'category', code);
    const printed = selectedField(card, 'printedCategory', code, null);
    const rawText = selectedField(card, 'text', code, '');
    if (typeof id !== 'string' || typeof category !== 'string'
      || (printed !== null && printed !== undefined && typeof printed !== 'string')
      || (rawText !== undefined && typeof rawText !== 'string') || rawText === null) reject(code);

    const rawCompiled = selectedField(card, 'compiled', code, null);
    let compiled = null;
    if (rawCompiled !== null && rawCompiled !== undefined) {
      selectedObject(rawCompiled, code, ancestors);
      try {
        const keywords = selectedField(rawCompiled, 'keywords', code);
        compiled = { keywords: selectedArray(keywords, code, ancestors, item => {
          selectedObject(item, code, ancestors);
          try {
            const name = selectedField(item, 'name', code);
            const intrinsic = selectedField(item, 'intrinsic', code, true);
            if (typeof name !== 'string' || (intrinsic !== null && intrinsic !== undefined && typeof intrinsic !== 'boolean')) reject(code);
            return { name, intrinsic: intrinsic ?? true };
          } finally { ancestors.delete(item); }
        }) };
      } finally { ancestors.delete(rawCompiled); }
    }

    const rawGranted = selectedField(card, 'grantedKeywords', code, []);
    const grantedKeywords = rawGranted === null || rawGranted === undefined ? []
      : selectedArray(rawGranted, code, ancestors, item => {
        if (typeof item !== 'string') reject(code);
        return item;
      });
    const rawTimed = selectedField(card, 'timedModifiers', code, []);
    const timedModifiers = rawTimed === null || rawTimed === undefined ? []
      : selectedArray(rawTimed, code, ancestors, item => {
        selectedObject(item, code, ancestors);
        try {
          const keyword = selectedField(item, 'keyword', code, null);
          if (keyword !== null && keyword !== undefined && typeof keyword !== 'string') reject(code);
          return { keyword: keyword ?? null };
        } finally { ancestors.delete(item); }
      });
    const rawMounted = selectedField(card, 'mounted', code, []);
    const mounted = rawMounted === null || rawMounted === undefined ? []
      : selectedArray(rawMounted, code, ancestors, provider => {
        selectedObject(provider, code, ancestors);
        try {
          const providerId = selectedField(provider, 'id', code);
          const protectConsumed = selectedField(provider, 'protectConsumed', code, false);
          if (typeof providerId !== 'string' || (protectConsumed !== null && protectConsumed !== undefined && typeof protectConsumed !== 'boolean')) reject(code);
          return { id: providerId, protectConsumed: protectConsumed ?? false };
        } finally { ancestors.delete(provider); }
      });
    return {
      id, category, printedCategory: printed ?? null, text: rawText ?? '', compiled,
      grantedKeywords, timedModifiers, mounted
    };
  } finally { ancestors.delete(card); }
}

function currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const refs = runtimeReferenceState(referenceInput, metadata);
  const built = buildRuntimeIdentityIndex(engineState);
  if (!built.ok) reject('INVALID_AUTHORITY');
  const cards = physicalCardMap(engineState);
  const frameCards = built.value.entries.map(entry => {
    const card = cards.get(entry.identity.instanceId);
    if (!card) reject('INVALID_AUTHORITY');
    const faceDown = own(card, 'faceDown', 'INVALID_AUTHORITY');
    if (typeof faceDown !== 'boolean') reject('INVALID_AUTHORITY');
    return {
      identity: { ...entry.identity }, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
      location: entry.location.kind === 'mounted'
        ? { ...entry.location, host: { ...entry.location.host } } : { ...entry.location }, faceDown
    };
  });
  const frame = { matchId: built.value.matchId, seatIds: [...metadata.seatIds], cards: frameCards };
  const found = lookupRuntimeCardReference(refs, {
    frame, matchId: metadata.matchId, viewerSeat: actorSeat, cardRef
  });
  if (!found.ok) {
    if (found.error.code === 'REF_INVALID_REFERENCE') reject('ACTION_NOT_ALLOWED');
    reject('INVALID_AUTHORITY');
  }
  const indexed = findIdentityEntry(built.value, found.value.identity);
  if (!indexed.ok || !indexed.value) reject('INVALID_AUTHORITY');
  const entry = indexed.value;
  const instanceId = entry.identity.instanceId;
  const card = cards.get(instanceId);
  if (!card) reject('INVALID_AUTHORITY');
  const uid = own(card, 'uid', 'INVALID_AUTHORITY');
  const rawIdentity = exact(own(card, 'identity', 'INVALID_AUTHORITY'), ['matchId', 'instanceId'], 'INVALID_AUTHORITY');
  if (uid !== `rt:${instanceId}` || rawIdentity.matchId !== entry.identity.matchId || rawIdentity.instanceId !== instanceId) reject('INVALID_AUTHORITY');
  if (!stateOwnerRegistered(entry.ownerSeat, metadata.seatIds)) reject('INVALID_AUTHORITY');
  return { entry, card, uid };
}

function restSecurityTarget(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'board' || entry.location.zone !== 'front'
    || entry.controllerSeat !== actorSeat || entry.location.seatId !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const faceDown = own(card, 'faceDown', 'INVALID_AUTHORITY');
  const asleep = own(card, 'sleep', 'INVALID_AUTHORITY');
  if (typeof faceDown !== 'boolean' || typeof asleep !== 'boolean') reject('INVALID_AUTHORITY');
  const view = securityEligibilityView(card);
  if (faceDown || asleep || !isObCard(view) || !cardHasKeyword(view, 'SECURITY')) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

function requireRegistryAction(engineState, playerId) {
  const players = own(engineState, 'players', 'INVALID_AUTHORITY');
  ordinary(players, 'INVALID_AUTHORITY');
  const player = own(players, playerId, 'INVALID_AUTHORITY');
  ordinary(player, 'INVALID_AUTHORITY');
  const used = own(player, 'registryActionUsed', 'INVALID_AUTHORITY');
  if (typeof used !== 'boolean') reject('INVALID_AUTHORITY');
  if (used) reject('ACTION_NOT_ALLOWED');
}

function installTarget(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry } = target;
  if (entry.location.kind !== 'zone' || entry.location.zone !== 'hand'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

function recoverRegistryTarget(engineState, referenceInput, cardRef, metadata, actorSeat) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry } = target;
  if (entry.location.kind !== 'zone' || entry.location.zone !== 'registry'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

function scriptEligibilityView(card) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const category = selectedField(card, 'category', code);
    const faceDown = selectedField(card, 'faceDown', code);
    const text = selectedField(card, 'text', code, '');
    if (!nonempty(id) || typeof category !== 'string' || typeof faceDown !== 'boolean'
      || (text !== null && text !== undefined && typeof text !== 'string')) reject(code);

    const rawCompiled = selectedField(card, 'compiled', code, MISSING);
    let compiled;
    if (rawCompiled !== MISSING && rawCompiled !== null && rawCompiled !== undefined) {
      selectedObject(rawCompiled, code, ancestors);
      try {
        compiled = { keywords: selectedArray(selectedField(rawCompiled, 'keywords', code), code, ancestors, item => {
          selectedObject(item, code, ancestors);
          try {
            const name = selectedField(item, 'name', code);
            const rawIntrinsic = selectedField(item, 'intrinsic', code, true);
            const rawValue = selectedField(item, 'value', code, null);
            const intrinsic = rawIntrinsic === null || rawIntrinsic === undefined ? true : rawIntrinsic;
            const value = rawValue === undefined ? null : rawValue;
            if (typeof name !== 'string' || typeof intrinsic !== 'boolean'
              || (value !== null && typeof value !== 'string'
                && (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)))) reject(code);
            return { name, intrinsic, value };
          } finally { ancestors.delete(item); }
        }) };
      } finally { ancestors.delete(rawCompiled); }
    }

    const rawCannotActivateTurn = selectedField(card, 'cannotActivateTurn', code, MISSING);
    const cannotActivateTurn = rawCannotActivateTurn === MISSING || rawCannotActivateTurn === null || rawCannotActivateTurn === undefined
      ? null : rawCannotActivateTurn;
    if (cannotActivateTurn !== null && !safeRevision(cannotActivateTurn)) reject(code);

    const rawDeclaredEffectId = selectedField(card, 'declaredEffectId', code, MISSING);
    let declaredEffectId = null;
    if (rawDeclaredEffectId !== MISSING && rawDeclaredEffectId !== null) {
      if (!nonempty(rawDeclaredEffectId)) reject(code);
      declaredEffectId = rawDeclaredEffectId;
    }

    const numeric = (key) => {
      const value = selectedField(card, key, code, MISSING);
      if (value === MISSING || value === null || value === undefined) return null;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) reject(code);
      return value;
    };
    const activationCost = numeric('activationCost');
    const cost = numeric('cost');
    const rawColor = selectedField(card, 'color', code, null);
    if (rawColor !== null && rawColor !== undefined && typeof rawColor !== 'string') reject(code);
    return {
      id, category, faceDown, text: text ?? '', ...(compiled ? { compiled } : {}),
      cannotActivateTurn, declaredEffectId, activationCost, cost, color: rawColor ?? null
    };
  } finally { ancestors.delete(card); }
}

function activationPlayerView(engineState, playerId, needsSymbols) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const memory = own(player, 'memory', code);
  if (typeof memory !== 'number' || !Number.isFinite(memory) || memory < 0 || Object.is(memory, -0)) reject(code);
  if (!needsSymbols) return { memory, registry: [] };
  const ancestors = new Set();
  const registry = selectedArray(own(player, 'registry', code), code, ancestors, card => {
    selectedObject(card, code, ancestors);
    try {
      const category = selectedField(card, 'category', code);
      const faceDown = selectedField(card, 'faceDown', code);
      const rawColor = selectedField(card, 'color', code, null);
      if (typeof category !== 'string' || typeof faceDown !== 'boolean'
        || (rawColor !== null && rawColor !== undefined && typeof rawColor !== 'string')) reject(code);
      return { category, faceDown, color: rawColor ?? null };
    } finally { ancestors.delete(card); }
  });
  return { memory, registry };
}

function activateScriptTarget(engineState, referenceInput, cardRef, metadata, actorSeat, playerId, mode) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'board' || entry.location.zone !== 'back'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const view = scriptEligibilityView(card);
  if (view.category !== 'Script' || !view.faceDown || view.declaredEffectId !== null
    || !supportsNormalScriptActivation(view)) reject('ACTION_NOT_ALLOWED');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  if (view.cannotActivateTurn === turnNumber) reject('ACTION_NOT_ALLOWED');
  const player = activationPlayerView(engineState, playerId, mode !== 'lab' && Boolean(view.color));
  const activationCost = view.activationCost ?? view.cost ?? 0;
  if (player.memory < activationCost) reject('ACTION_NOT_ALLOWED');
  if (mode !== 'lab' && view.color && !enabledSymbols(player).includes(view.color)) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

const finiteNumberField = readFiniteNumber;

function executionCardView(card) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const name = selectedField(card, 'name', code);
    const category = selectedField(card, 'category', code);
    const printedCategoryRaw = selectedField(card, 'printedCategory', code, null);
    const textRaw = selectedField(card, 'text', code, '');
    const colorRaw = selectedField(card, 'color', code, null);
    const dragFreeRaw = selectedField(card, 'dragFree', code, false);
    if (!nonempty(id) || typeof name !== 'string' || typeof category !== 'string'
      || (printedCategoryRaw !== null && printedCategoryRaw !== undefined && typeof printedCategoryRaw !== 'string')
      || (textRaw !== null && textRaw !== undefined && typeof textRaw !== 'string')
      || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')
      || (dragFreeRaw !== null && dragFreeRaw !== undefined && typeof dragFreeRaw !== 'boolean')) reject(code);
    const view = {
      id, name, category, printedCategory: printedCategoryRaw ?? null, text: textRaw ?? '', color: colorRaw ?? null,
      cost: finiteNumberField(card, 'cost', code, { minimum: 0 }),
      turnCostModifier: finiteNumberField(card, 'turnCostModifier', code),
      costReductionThisTurn: finiteNumberField(card, 'costReductionThisTurn', code, { minimum: 0 }),
      dragFree: dragFreeRaw ?? false
    };
    const revealed = selectedField(card, 'revealedExecutionCost', code, MISSING);
    if (revealed !== MISSING && revealed !== null && revealed !== undefined) {
      if (revealed !== 1) reject(code);
      view.revealedExecutionCost = 1;
    }
    const setupCost = selectedField(card, 'setupCost', code, MISSING);
    if (setupCost !== MISSING && setupCost !== null && setupCost !== undefined) {
      if (typeof setupCost !== 'number' || !Number.isFinite(setupCost) || setupCost < 0 || Object.is(setupCost, -0)) reject(code);
      view.setupCost = setupCost;
    }
    return view;
  } finally { ancestors.delete(card); }
}

function executionProviderView(card, controllerId, zone) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const name = selectedField(card, 'name', code);
    const category = selectedField(card, 'category', code);
    const printedCategoryRaw = selectedField(card, 'printedCategory', code, null);
    const faceDown = selectedField(card, 'faceDown', code);
    const colorRaw = selectedField(card, 'color', code, null);
    const rawClasses = selectedField(card, 'classes', code, []);
    const classes = selectedArray(rawClasses, code, ancestors, item => {
      if (typeof item !== 'string' || item.length === 0) reject(code);
      return item;
    });
    if (!nonempty(id) || typeof name !== 'string' || typeof category !== 'string' || typeof faceDown !== 'boolean'
      || (printedCategoryRaw !== null && printedCategoryRaw !== undefined && typeof printedCategoryRaw !== 'string')
      || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')) reject(code);
    const view = { id, name, category, printedCategory: printedCategoryRaw ?? null, faceDown, color: colorRaw ?? null, classes };
    if (zone === 'front' || zone === 'back') {
      const slot = selectedField(card, 'boardSlot', code);
      const slotController = selectedField(card, 'boardSlotController', code);
      const slotZone = selectedField(card, 'boardSlotZone', code);
      if (!Number.isSafeInteger(slot) || slot < 1 || Object.is(slot, -0)
        || slotController !== controllerId || slotZone !== zone) reject(code);
      Object.assign(view, { boardSlot: slot, boardSlotController: slotController, boardSlotZone: slotZone });
    }
    return view;
  } finally { ancestors.delete(card); }
}

function executionPlayerView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let userView;
  try {
    const frontLimit = selectedField(user, 'frontLimit', code);
    const backLimit = selectedField(user, 'backLimit', code);
    const abilityRaw = selectedField(user, 'abilityKey', code, null);
    if (!Number.isSafeInteger(frontLimit) || frontLimit < 0 || Object.is(frontLimit, -0)
      || !Number.isSafeInteger(backLimit) || backLimit < 0 || Object.is(backLimit, -0)
      || (abilityRaw !== null && abilityRaw !== undefined && typeof abilityRaw !== 'string')) reject(code);
    userView = { frontLimit, backLimit, abilityKey: abilityRaw ?? null };
  } finally { ancestors.delete(user); }

  const zone = (name) => selectedArray(selectedField(player, name, code), code, new Set(), card =>
    executionProviderView(card, playerId, name));
  const firstRaw = selectedField(player, 'firstObExecutionTurn', code, null);
  if (firstRaw !== null && firstRaw !== undefined && !safeRevision(firstRaw)) reject(code);
  return {
    memory: finiteNumberField(player, 'memory', code, { minimum: 0 }),
    firstObExecutionTurn: firstRaw ?? null,
    front: zone('front'), back: zone('back'), registry: zone('registry'), trash: zone('trash'), user: userView
  };
}

function executionPlanningView(engineState) {
  const active = own(engineState, 'active', 'INVALID_AUTHORITY');
  const mode = own(engineState, 'mode', 'INVALID_AUTHORITY');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!['player', 'ai'].includes(active) || !['ai', 'tutorial', 'lab', 'sandbox'].includes(mode)
    || !safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  return {
    active, mode, turnNumber,
    players: {
      player: executionPlayerView(engineState, 'player'),
      ai: executionPlayerView(engineState, 'ai')
    }
  };
}

function executeCardTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const target = currentReferencedCard(engineState, referenceInput, action.cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'zone' || entry.location.zone !== 'hand'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const cardView = executionCardView(card);
  if (!supportsDirectHandObExecution(cardView) || cardView.dragFree) reject('ACTION_NOT_ALLOWED');
  const stateView = executionPlanningView(engineState);
  const options = { zone: action.destination.zone, requestedSlot: action.destination.slot };
  if (!canExecuteAtSlot(stateView, playerId, cardView, options).ok) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid, options };
}

function layeredCardView(card, controllerId, zone) {
  const code = 'INVALID_AUTHORITY';
  const keywordView = securityEligibilityView(card);
  const executionView = executionCardView(card);
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const uid = selectedField(card, 'uid', code);
    const faceDown = selectedField(card, 'faceDown', code);
    const rawClasses = selectedField(card, 'classes', code, []);
    const classes = selectedArray(rawClasses, code, ancestors, item => {
      if (!nonempty(item)) reject(code);
      return item;
    });
    if (!nonempty(uid) || typeof faceDown !== 'boolean') reject(code);
    const view = { ...keywordView, ...executionView, uid, faceDown, classes };
    if (zone === 'front' || zone === 'back') {
      const slot = selectedField(card, 'boardSlot', code);
      const slotController = selectedField(card, 'boardSlotController', code);
      const slotZone = selectedField(card, 'boardSlotZone', code);
      if (!Number.isSafeInteger(slot) || slot < 1 || Object.is(slot, -0)
        || slotController !== controllerId || slotZone !== zone) reject(code);
      Object.assign(view, { boardSlot: slot, boardSlotController: slotController, boardSlotZone: slotZone });
    }
    return view;
  } finally { ancestors.delete(card); }
}

function layeredPlayerView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let userView;
  try {
    const frontLimit = selectedField(user, 'frontLimit', code);
    const backLimit = selectedField(user, 'backLimit', code);
    const abilityRaw = selectedField(user, 'abilityKey', code, null);
    if (!Number.isSafeInteger(frontLimit) || frontLimit < 0 || Object.is(frontLimit, -0)
      || !Number.isSafeInteger(backLimit) || backLimit < 0 || Object.is(backLimit, -0)
      || (abilityRaw !== null && abilityRaw !== undefined && typeof abilityRaw !== 'string')) reject(code);
    userView = { frontLimit, backLimit, abilityKey: abilityRaw ?? null };
  } finally { ancestors.delete(user); }
  const zoneView = name => selectedArray(selectedField(player, name, code), code, new Set(), card =>
    layeredCardView(card, playerId, name));
  const firstRaw = selectedField(player, 'firstObExecutionTurn', code, null);
  if (firstRaw !== null && firstRaw !== undefined && !safeRevision(firstRaw)) reject(code);
  return {
    memory: finiteNumberField(player, 'memory', code, { minimum: 0 }),
    firstObExecutionTurn: firstRaw ?? null,
    hand: zoneView('hand'), front: zoneView('front'), back: zoneView('back'),
    registry: zoneView('registry'), trash: zoneView('trash'), user: userView
  };
}

function layeredPlanningView(engineState) {
  const active = own(engineState, 'active', 'INVALID_AUTHORITY');
  const mode = own(engineState, 'mode', 'INVALID_AUTHORITY');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!['player', 'ai'].includes(active) || !['ai', 'tutorial', 'lab', 'sandbox'].includes(mode)
    || !safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  return {
    active, mode, turnNumber,
    players: { player: layeredPlayerView(engineState, 'player'), ai: layeredPlayerView(engineState, 'ai') }
  };
}

function executeLayeredTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const source = currentReferencedCard(engineState, referenceInput, action.cardRef, metadata, actorSeat);
  if (source.entry.location.kind !== 'zone' || source.entry.location.zone !== 'hand'
    || source.entry.location.seatId !== actorSeat || source.entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const materials = action.materialRefs.map(cardRef =>
    currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat));
  const materialUids = materials.map(material => material.uid);
  if (materialUids.includes(source.uid) || new Set(materialUids).size !== materialUids.length) reject('ACTION_NOT_ALLOWED');
  for (const material of materials) {
    const location = material.entry.location;
    const allowed = location.kind === 'board' && ['front', 'back'].includes(location.zone)
      || location.kind === 'zone' && ['hand', 'registry'].includes(location.zone);
    if (!allowed) reject('ACTION_NOT_ALLOWED');
  }
  const stateView = layeredPlanningView(engineState);
  if (!canPlayLayeredCard(stateView, playerId, source.uid, materialUids,
    action.destination.zone, action.destination.slot).ok) reject('ACTION_NOT_ALLOWED');
  return {
    uid: source.uid, materialUids, zone: action.destination.zone,
    options: { requestedSlot: action.destination.slot }
  };
}

function selectedLayerCount(card, code, ancestors = new Set()) {
  const mounted = selectedField(card, 'mounted', code, []);
  return selectedArray(mounted, code, ancestors, layer => {
    selectedObject(layer, code, ancestors);
    try { return 1 + selectedLayerCount(layer, code, ancestors); }
    finally { ancestors.delete(layer); }
  }).reduce((sum, count) => sum + count, 0);
}

function redeployTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const target = currentReferencedCard(engineState, referenceInput, action.cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'board' || !['front', 'back'].includes(entry.location.zone)
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat
    || action.destination.zone === entry.location.zone) reject('ACTION_NOT_ALLOWED');
  const cardView = executionCardView(card);
  const layerCount = selectedLayerCount(card, 'INVALID_AUTHORITY');
  const stateView = executionPlanningView(engineState);
  const options = {
    sourceZone: entry.location.zone,
    zone: action.destination.zone,
    requestedSlot: action.destination.slot,
    layerCount
  };
  if (!canDirectRelogAtSlot(stateView, playerId, cardView, options).ok) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid, targetZone: options.zone, options: { requestedSlot: options.requestedSlot } };
}

function attackCardView(card) {
  const code = 'INVALID_AUTHORITY';
  const keywordView = securityEligibilityView(card);
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const uid = selectedField(card, 'uid', code);
    const name = selectedField(card, 'name', code);
    const colorRaw = selectedField(card, 'color', code, null);
    const faceDown = selectedField(card, 'faceDown', code);
    const sleep = selectedField(card, 'sleep', code);
    const summoningSick = selectedField(card, 'summoningSick', code);
    if (!nonempty(uid) || typeof name !== 'string'
      || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')
      || typeof faceDown !== 'boolean' || typeof sleep !== 'boolean' || typeof summoningSick !== 'boolean') reject(code);

    const rawClasses = selectedField(card, 'classes', code, []);
    const classes = selectedArray(rawClasses, code, ancestors, item => {
      if (!nonempty(item)) reject(code);
      return item;
    });
    const timedRaw = selectedField(card, 'timedModifiers', code, []);
    const timedModifiers = selectedArray(timedRaw, code, ancestors, item => {
      selectedObject(item, code, ancestors);
      try {
        const result = {};
        for (const key of ['keyword', 'atk', 'expiresAfterTurn']) {
          const value = selectedField(item, key, code, MISSING);
          if (value === MISSING || value === null || value === undefined) continue;
          if (key === 'keyword') {
            if (!nonempty(value)) reject(code);
          } else if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
            || (key === 'expiresAfterTurn' && (!Number.isSafeInteger(value) || value < 0))) reject(code);
          result[key] = value;
        }
        return result;
      } finally { ancestors.delete(item); }
    });
    const mountedRaw = selectedField(card, 'mounted', code, []);
    const mounted = selectedArray(mountedRaw, code, ancestors, provider => {
      selectedObject(provider, code, ancestors);
      try {
        const id = selectedField(provider, 'id', code);
        const protectRaw = selectedField(provider, 'protectConsumed', code, false);
        if (!nonempty(id) || (protectRaw !== null && protectRaw !== undefined && typeof protectRaw !== 'boolean')) reject(code);
        return { id, protectConsumed: protectRaw ?? false };
      } finally { ancestors.delete(provider); }
    });
    const std220Raw = selectedField(card, 'std220RegistryExecutedTurn', code, null);
    if (std220Raw !== null && std220Raw !== undefined && !safeRevision(std220Raw)) reject(code);
    return {
      ...keywordView, uid, name, color: colorRaw ?? null, classes, faceDown, sleep, summoningSick,
      atk: finiteNumberField(card, 'atk', code), tempAtk: finiteNumberField(card, 'tempAtk', code),
      permanentAtk: finiteNumberField(card, 'permanentAtk', code), load: finiteNumberField(card, 'load', code),
      timedModifiers, mounted, std220RegistryExecutedTurn: std220Raw ?? null
    };
  } finally { ancestors.delete(card); }
}

function attackPlayerView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let abilityKey;
  try {
    const raw = selectedField(user, 'abilityKey', code, null);
    if (raw !== null && raw !== undefined && typeof raw !== 'string') reject(code);
    abilityKey = raw ?? null;
  } finally { ancestors.delete(user); }
  const scriptActivatedRaw = selectedField(player, 'scriptActivatedTurn', code, null);
  if (scriptActivatedRaw !== null && scriptActivatedRaw !== undefined && !safeRevision(scriptActivatedRaw)) reject(code);
  const zone = name => selectedArray(selectedField(player, name, code), code, new Set(), attackCardView);
  const registry = selectedArray(selectedField(player, 'registry', code), code, new Set(), card => {
    const cardCode = 'INVALID_AUTHORITY';
    const cardAncestors = new Set();
    selectedObject(card, cardCode, cardAncestors);
    try {
      const category = selectedField(card, 'category', cardCode);
      const faceDown = selectedField(card, 'faceDown', cardCode);
      const colorRaw = selectedField(card, 'color', cardCode, null);
      if (typeof category !== 'string' || typeof faceDown !== 'boolean'
        || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')) reject(cardCode);
      return { category, faceDown, color: colorRaw ?? null };
    } finally { cardAncestors.delete(card); }
  });
  return {
    front: zone('front'), back: zone('back'), registry,
    scriptActivatedTurn: scriptActivatedRaw ?? null, user: { abilityKey }
  };
}

function attackPlanningView(engineState) {
  const active = own(engineState, 'active', 'INVALID_AUTHORITY');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!['player', 'ai'].includes(active) || !safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  return {
    active, turnNumber,
    players: { player: attackPlayerView(engineState, 'player'), ai: attackPlayerView(engineState, 'ai') }
  };
}

function attackTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const attacker = currentReferencedCard(engineState, referenceInput, action.attackerRef, metadata, actorSeat);
  if (attacker.entry.location.kind !== 'board' || attacker.entry.location.zone !== 'front'
    || attacker.entry.location.seatId !== actorSeat || attacker.entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const opponentId = playerId === 'player' ? 'ai' : 'player';
  const opponentSeat = metadata.seatIds[opponentId === 'player' ? 0 : 1];
  let targetUid;
  if (action.target.kind === 'user') {
    if (action.target.seatId !== opponentSeat) reject('ACTION_NOT_ALLOWED');
    targetUid = `${opponentId}-fortress`;
  } else {
    const target = currentReferencedCard(engineState, referenceInput, action.target.cardRef, metadata, actorSeat);
    if (target.entry.location.kind !== 'board' || target.entry.location.zone !== 'front'
      || target.entry.location.seatId !== opponentSeat || target.entry.controllerSeat !== opponentSeat) reject('ACTION_NOT_ALLOWED');
    targetUid = target.uid;
  }
  const view = attackPlanningView(engineState);
  const attackerView = view.players[playerId].front.find(card => card.uid === attacker.uid);
  if (!attackerView || !canAttack(view, playerId, attackerView)
    || !getAttackTargets(view, playerId, attackerView).some(candidate => candidate.uid === targetUid)) reject('ACTION_NOT_ALLOWED');
  return { attackerUid: attacker.uid, targetUid };
}

function mulliganEligibilityView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const active = own(engineState, 'active', code);
  const turnNumber = own(engineState, 'turnNumber', code);
  if (!['player', 'ai'].includes(active) || !safeRevision(turnNumber)) reject(code);
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let userView;
  try {
    const abilityKey = selectedField(user, 'abilityKey', code);
    const initialHandRaw = selectedField(user, 'initialHand', code, null);
    if (typeof abilityKey !== 'string'
      || (initialHandRaw !== null && initialHandRaw !== undefined
        && (!Number.isSafeInteger(initialHandRaw) || initialHandRaw < 0 || Object.is(initialHandRaw, -0)))) reject(code);
    userView = { abilityKey, initialHand: initialHandRaw ?? 5 };
  } finally { ancestors.delete(user); }
  const mulligansUsed = selectedField(player, 'mulligansUsed', code);
  if (!Number.isSafeInteger(mulligansUsed) || mulligansUsed < 0 || Object.is(mulligansUsed, -0)) reject(code);
  const zone = name => selectedArray(selectedField(player, name, code), code, new Set(), () => null);
  return {
    active, turnNumber,
    players: { [playerId]: {
      user: userView, mulligansUsed,
      hand: zone('hand'), front: zone('front'), back: zone('back'), registry: zone('registry'),
      trash: zone('trash'), ban: zone('ban')
    } }
  };
}

function turboEligibilityView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const active = own(engineState, 'active', code);
  if (!['player', 'ai'].includes(active)) reject(code);
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = own(player, 'user', code);
  ordinary(user, code);
  const abilityKey = selectedField(user, 'abilityKey', code, null);
  const turboUsed = selectedField(player, 'turboUsed', code);
  if ((abilityKey !== null && abilityKey !== undefined && typeof abilityKey !== 'string')
    || typeof turboUsed !== 'boolean') reject(code);
  return {
    active,
    players: { [playerId]: { user: { abilityKey: abilityKey ?? null }, turboUsed } }
  };
}

function sandboxAddEligibilityView(engineState, mode, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  return { mode, players: { [playerId]: {} } };
}

function stateOwnerRegistered(ownerSeat, seats) { return seats.includes(ownerSeat); }

function prepared(canonical, adapter) {
  return { ok: true, value: {
    kind: 'prepared', command: canonical.value.command,
    canonicalPayload: canonical.value.canonicalPayload, adapter
  } };
}

function prepareSandboxAddAction({ source, engine, metadata, canonical }) {
  if (!['lab', 'sandbox'].includes(engine.mode)) reject('UNAVAILABLE_MODE');
  if (engine.hasResult || engine.busy) reject('ACTION_NOT_ALLOWED');
  const targetIndex = metadata.seatIds.indexOf(canonical.value.command.action.targetSeat);
  if (targetIndex < 0) reject('ACTION_NOT_ALLOWED');
  const targetPlayerId = targetIndex === 0 ? 'player' : 'ai';
  if (!canAddSandboxCardToHand(
    sandboxAddEligibilityView(source.engineState, engine.mode, targetPlayerId),
    targetPlayerId,
    canonical.value.command.action.definitionId
  )) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, {
    engineFunction: 'addSandboxCardToHand', playerId: targetPlayerId,
    cardId: canonical.value.command.action.definitionId
  });
}

function prepareAttackAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = attackTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, {
    engineFunction: 'attack', playerId, attackerUid: target.attackerUid, targetUid: target.targetUid
  });
}

function prepareRestSecurityAction({ source, engine, metadata, trusted, canonical, playerId, readReferenceState }) {
  if (engine.securityRestWindow !== playerId) reject('ACTION_NOT_ALLOWED');
  const target = restSecurityTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat);
  return prepared(canonical, { engineFunction: 'restSecurity', playerId, uid: target.uid });
}

function prepareInstallAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  requireRegistryAction(source.engineState, playerId);
  const target = installTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat);
  return prepared(canonical, { engineFunction: 'installCard', playerId, uid: target.uid });
}

function prepareRecoverRegistryAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  requireRegistryAction(source.engineState, playerId);
  const target = recoverRegistryTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat);
  return prepared(canonical, { engineFunction: 'recoverRegistryCard', playerId, uid: target.uid });
}

function prepareActivateScriptAction({ source, engine, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = activateScriptTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat, playerId, engine.mode);
  return prepared(canonical, { engineFunction: 'activateScript', playerId, uid: target.uid });
}

function prepareExecuteCardAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = executeCardTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, { engineFunction: 'playCard', playerId, uid: target.uid, options: target.options });
}

function prepareExecuteLayeredAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = executeLayeredTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, {
    engineFunction: 'playLayeredCard', playerId, uid: target.uid,
    materialUids: target.materialUids, zone: target.zone, options: target.options
  });
}

function prepareRedeployAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = redeployTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, {
    engineFunction: 'relogCard', playerId, uid: target.uid,
    targetZone: target.targetZone, options: target.options
  });
}

function prepareOpeningMulliganAction({ source, canonical, playerId }) {
  if (!canOpeningMulligan(mulliganEligibilityView(source.engineState, playerId), playerId)) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, { engineFunction: 'openingMulligan', playerId });
}

function prepareActivateAbilityAction({ source, canonical, playerId }) {
  if (!canActivateTurbo(turboEligibilityView(source.engineState, playerId), playerId)) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, { engineFunction: 'activateTurbo', playerId });
}

function prepareEndTurnAction({ canonical, playerId }) {
  return prepared(canonical, { engineFunction: 'endTurn', playerId });
}

function prepareChoiceAction({ authority, trusted, canonical }) {
  const result = prepareRequiredInputAction(authority, trusted.actorSeat, canonical.value.command.action);
  if (!result.ok) reject(result.error.code);
  return prepared(canonical, result.value);
}

const ACTION_REGISTRY = createActionRegistry([
  { type: 'endTurn', requiresReferenceState: false, prepare: prepareEndTurnAction },
  { type: 'restSecurity', requiresReferenceState: true, prepare: prepareRestSecurityAction },
  { type: 'install', requiresReferenceState: true, prepare: prepareInstallAction },
  { type: 'recoverRegistry', requiresReferenceState: true, prepare: prepareRecoverRegistryAction },
  { type: 'activateScript', requiresReferenceState: true, prepare: prepareActivateScriptAction },
  { type: 'executeCard', requiresReferenceState: true, prepare: prepareExecuteCardAction },
  { type: 'executeLayered', requiresReferenceState: true, prepare: prepareExecuteLayeredAction },
  { type: 'redeploy', requiresReferenceState: true, prepare: prepareRedeployAction },
  { type: 'attack', requiresReferenceState: true, prepare: prepareAttackAction },
  { type: 'openingMulligan', requiresReferenceState: false, prepare: prepareOpeningMulliganAction },
  { type: 'activateAbility', requiresReferenceState: false, prepare: prepareActivateAbilityAction },
  { type: 'sandboxAddCard', requiresReferenceState: false, prepare: prepareSandboxAddAction },
  { type: 'answerChoice', requiresReferenceState: true, prepare: prepareChoiceAction },
  { type: 'declineChoice', requiresReferenceState: true, prepare: prepareChoiceAction }
]);

export function prepareRuntimeCommand(authority, context, envelope) {
  try {
    const canonical = canonicalizeCommand(envelope);
    if (!canonical.ok) return canonical;
    const trusted = exact(context, ['matchId', 'actorSeat'], 'NOT_AUTHORIZED');
    if (!nonempty(trusted.matchId) || !nonempty(trusted.actorSeat) || trusted.matchId !== canonical.value.command.matchId
      || trusted.actorSeat !== canonical.value.command.actorSeat) reject('NOT_AUTHORIZED');

    const header = publicAuthorityHeader(authority);
    if (header.matchId !== trusted.matchId || !header.seatIds.includes(trusted.actorSeat)) reject('NOT_AUTHORIZED');

    const action = lookupActionHandler(ACTION_REGISTRY, canonical.value.command.action.type);
    if (!action) reject('ACTION_SCHEMA_UNAVAILABLE');
    const journal = journalAfterAuthorization(authority, action.requiresReferenceState);
    const classified = classifyCommand(journal, trusted, envelope);
    if (!classified.ok) return classified;
    if (classified.value.kind === 'retry') return { ok: true, value: classified.value };

    const source = action.requiresReferenceState
      ? {
        metadata: own(authority, 'metadata', 'INVALID_AUTHORITY'),
        revision: own(authority, 'revision', 'INVALID_AUTHORITY'),
        engineState: own(authority, 'engineState', 'INVALID_AUTHORITY'),
        journal
      }
      : authorityData(authority);
    const metadata = metadataData(source.metadata);
    if (metadata.matchId !== trusted.matchId || !metadata.seatIds.includes(trusted.actorSeat)) reject('NOT_AUTHORIZED');
    const engine = engineData(source.engineState, metadata, action.type === 'restSecurity');
    journalSeatOrder(source.journal, metadata);
    if (!safeRevision(source.revision)) reject('INVALID_AUTHORITY');
    if (canonical.value.command.expectedRevision !== source.revision) reject('STALE_REVISION');
    if (source.revision === Number.MAX_SAFE_INTEGER) reject('REVISION_EXHAUSTED');
    const readReferenceState = () => own(authority, 'referenceState', 'INVALID_AUTHORITY');
    const preparation = { authority, source, engine, metadata, trusted, canonical, readReferenceState };
    if (action.type === 'sandboxAddCard') return action.prepare(preparation);
    if (CHOICE_ACTIONS.has(action.type)) return action.prepare(preparation);

    if (engine.mode === 'tutorial') reject('UNAVAILABLE_MODE');
    const playerId = engine.active;
    const activeSeat = metadata.seatIds[playerId === 'player' ? 0 : 1];
    if (trusted.actorSeat !== activeSeat) reject('ACTION_NOT_ALLOWED');
    if (engine.hasResult) reject('ACTION_NOT_ALLOWED');
    if (engine.busy) reject('ACTION_NOT_ALLOWED');

    return action.prepare({ ...preparation, playerId });
  } catch (error) {
    if (error instanceof CommandBridgeError || error instanceof SafeReadError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}
