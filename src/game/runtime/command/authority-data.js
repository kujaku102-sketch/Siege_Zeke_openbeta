import { isTutorialId, tutorialAiDeckId, tutorialPlayerDeckId } from '../tutorial-setup.js';
import { MISSING, dense, exact, nonempty, ordinary, own, reject } from './common.js';

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

export function seatIds(value) {
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

export function metadataData(value) {
  const metadata = exact(value, METADATA_KEYS, 'INVALID_AUTHORITY');
  if (!nonempty(metadata.matchId) || !nonempty(metadata.ruleVersion) || !nonempty(metadata.cardVersion)) reject('INVALID_AUTHORITY');
  metadata.seatIds = seatIds(metadata.seatIds);
  // 'openingProtocol' is stored only for v2.4 matches; its absence is the legacy opening.
  ordinary(metadata.startOptions, 'INVALID_AUTHORITY');
  const hasProtocol = Object.hasOwn(metadata.startOptions, 'openingProtocol');
  const options = exact(metadata.startOptions, hasProtocol ? [...START_OPTION_KEYS, 'openingProtocol'] : START_OPTION_KEYS, 'INVALID_AUTHORITY');
  if (hasProtocol && (options.openingProtocol !== 'v2.4' || options.mode !== 'ai')) reject('INVALID_AUTHORITY');
  if (!['ai', 'tutorial', 'lab', 'sandbox'].includes(options.mode) || !isTutorialId(options.tutorialId)
    || !nonempty(options.playerDeckId) || !nonempty(options.aiDeckId) || !nonempty(options.playerUserId) || !nonempty(options.aiUserId)
    || typeof options.sandboxDeckSetup !== 'boolean') reject('INVALID_AUTHORITY');
  options.playerDeckRecipe = recipe(options.playerDeckRecipe);
  options.aiDeckRecipe = recipe(options.aiDeckRecipe);
  metadata.startOptions = options;
  return metadata;
}

export function authorityData(value) {
  return exact(value, AUTHORITY_KEYS, 'INVALID_AUTHORITY');
}

export function publicAuthorityHeader(value) {
  ordinary(value, 'INVALID_AUTHORITY');
  const metadata = own(value, 'metadata', 'INVALID_AUTHORITY');
  ordinary(metadata, 'INVALID_AUTHORITY');
  const matchId = own(metadata, 'matchId', 'INVALID_AUTHORITY');
  const seats = seatIds(own(metadata, 'seatIds', 'INVALID_AUTHORITY'));
  if (!nonempty(matchId)) reject('INVALID_AUTHORITY');
  return { matchId, seatIds: seats };
}

export function journalAfterAuthorization(value, usesReference) {
  const keys = Reflect.ownKeys(value);
  const expected = usesReference ? REFERENCE_AUTHORITY_KEYS : AUTHORITY_KEYS;
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) reject('INVALID_AUTHORITY');
  return own(value, 'journal', 'INVALID_AUTHORITY');
}

export function sameSeats(left, right) { return left.length === right.length && left.every((seat, index) => seat === right[index]); }

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

export function engineData(value, metadata, restSecurity = false) {
  ordinary(value, 'INVALID_AUTHORITY');
  validateRuntimeContext(own(value, 'runtimeContext', 'INVALID_AUTHORITY'), metadata);
  const options = metadata.startOptions;
  const state = {
    mode: own(value, 'mode', 'INVALID_AUTHORITY'), tutorialId: own(value, 'tutorialId', 'INVALID_AUTHORITY'),
    playerDeckId: own(value, 'playerDeckId', 'INVALID_AUTHORITY'), aiDeckId: own(value, 'aiDeckId', 'INVALID_AUTHORITY'),
    playerUserId: own(value, 'playerUserId', 'INVALID_AUTHORITY'), aiUserId: own(value, 'aiUserId', 'INVALID_AUTHORITY'),
    active: own(value, 'active', 'INVALID_AUTHORITY'), winner: own(value, 'winner', 'INVALID_AUTHORITY'),
    phase: own(value, 'phase', 'INVALID_AUTHORITY'), interactive: own(value, 'interactive', 'INVALID_AUTHORITY'), busy: false,
    opening: Object.hasOwn(value, 'opening')
  };
  if (state.opening) ordinary(own(value, 'opening', 'INVALID_AUTHORITY'), 'INVALID_AUTHORITY');
  const tutorial = options.mode === 'tutorial';
  const expectedPlayerDeck = tutorial ? tutorialPlayerDeckId(options.tutorialId, options.playerDeckId) : options.playerDeckId;
  const expectedAiDeck = tutorial ? tutorialAiDeckId(options.tutorialId, options.aiDeckId) : options.aiDeckId;
  if (!['ai', 'tutorial', 'lab', 'sandbox'].includes(state.mode) || state.mode !== options.mode
    || !isTutorialId(state.tutorialId) || state.tutorialId !== options.tutorialId
    || !nonempty(state.playerDeckId) || state.playerDeckId !== expectedPlayerDeck || !nonempty(state.aiDeckId) || state.aiDeckId !== expectedAiDeck
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
  // The opening decisions happen in their own phase before the first turn.
  if (state.phase !== 'main' && !(state.opening && state.phase === 'opening')) state.busy = true;
  return state;
}

export function journalSeatOrder(value, metadata) {
  const journal = exact(value, ['schemaVersion', 'matchId', 'seatIds', 'entries'], 'INVALID_AUTHORITY');
  if (journal.schemaVersion !== 1 || journal.matchId !== metadata.matchId || !sameSeats(seatIds(journal.seatIds), metadata.seatIds)) reject('INVALID_AUTHORITY');
}
