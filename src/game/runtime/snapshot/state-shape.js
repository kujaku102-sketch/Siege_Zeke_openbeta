import { restoreRngState } from '../rng.js';
import { buildRequiredInput } from '../required-input.js';
import { FORMAT_ERROR, INVALID, SnapshotError, STATE, UNSUPPORTED, copyJson, dense, exact, nonempty, ordinary, own, reject, seatIds } from './guards.js';

const STATE_KEYS = [
  'runtimeContext', 'mode', 'tutorialId', 'playerDeckId', 'aiDeckId', 'playerUserId', 'aiUserId', 'players', 'active',
  'firstPlayer', 'turnNumber', 'phase', 'winner', 'victory', 'projectionSerial', 'projectionSlotRevision',
  'selectionQueueSerial', 'selectionQueue', 'legacyProjectionOwnerSerial', 'effectResolution', 'effectSerial',
  'victoryFacts', 'selectedUid', 'openAdmin', 'pending', 'prompt', 'mandatoryDrawContinuation', 'message', 'log',
  'tokenSerial', 'provisional', 'events', 'activationWindows', 'scriptActivationQueue', 'lastEventContext',
  'triggerQueue', 'triggerSerial', 'processingTriggers', 'effectDepth', 'turnStats', 'delayedEffects',
  'declaredEffects', 'declarationSerial', 'resolvingDeclaredEffect', 'deferredDeclaredResponseCleanup',
  'deferredDeclaredScriptCleanup', 'placementCostBatch', 'responseEventQueue', 'resolvingResponse',
  'triggerThread', 'threadNotice', 'interactive', 'userAbilityFeedbackState'
];
const OPTIONAL_ROOT = {
  null: ['deferredAttack', 'deferredDestruction', 'deferredSpellCleanup', 'std230AmbushCleanup', 'securityRestWindow',
    'attackResumeStage', 'std094TurnEndQueue', 'std141TurnEndQueue', 'std142TurnEndQueue', 'opening', 'std142DestroyBatch', 'std211DestructionBatch'],
  array: ['deferredTrashMoves', 'destroyLkiFollowUps', 'independentEffects'],
  object: ['runtimeDestructionContinuations', 'std142DestructionContinuations', 'std211DestructionContinuations'],
  boolean: ['drainingIndependentEffects', 'resolvingStd165', 'skipSavageTurnEnd'],
  player: ['std094TurnEndDone', 'std141TurnEndDone', 'std142TurnEndDone', 'resumeTurnEndAfterSelection'],
  turnTable: ['fieldEntryTurns']
};
const CONTEXT_KEYS = ['matchId', 'seatIds', 'identityState', 'rngState', 'uidAliases'];

export function allowedRootKeys(input, code, live) {
  ordinary(input, code);
  const keys = Reflect.ownKeys(input);
  const allowed = [...STATE_KEYS, ...Object.values(OPTIONAL_ROOT).flat(), ...(live ? ['rng', 'history'] : [])];
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) reject(UNSUPPORTED);
  for (const key of STATE_KEYS) if (!keys.includes(key)) reject(code);
  if (live) {
    if (!keys.includes('rng') || !keys.includes('history')) reject(code);
    if (typeof own(input, 'rng', code) !== 'function' || dense(own(input, 'history', UNSUPPORTED), UNSUPPORTED).length !== 0) reject(UNSUPPORTED);
  }
  const state = {};
  for (const key of keys) {
    if (live && ['rng', 'history'].includes(key)) continue;
    state[key] = own(input, key, code);
  }
  return state;
}

function validateOptionalRoot(state) {
  for (const name of OPTIONAL_ROOT.null) {
    if (Object.hasOwn(state, name) && own(state, name, STATE) !== null) reject(UNSUPPORTED);
  }
  for (const name of OPTIONAL_ROOT.array) {
    if (!Object.hasOwn(state, name)) continue;
    const value = own(state, name, STATE);
    const rows = dense(value, STATE);
    copyJson(rows, STATE);
    if (rows.length !== 0) reject(UNSUPPORTED);
  }
  for (const name of OPTIONAL_ROOT.object) {
    if (!Object.hasOwn(state, name)) continue;
    const object = own(state, name, STATE);
    ordinary(object, STATE);
    copyJson(object, STATE);
    if (Reflect.ownKeys(object).length !== 0) reject(UNSUPPORTED);
  }
  for (const name of OPTIONAL_ROOT.boolean) {
    if (!Object.hasOwn(state, name)) continue;
    const value = own(state, name, STATE);
    if (typeof value !== 'boolean') reject(STATE);
    if (value) reject(UNSUPPORTED);
  }
  for (const name of OPTIONAL_ROOT.player) {
    if (!Object.hasOwn(state, name)) continue;
    const value = own(state, name, STATE);
    if (value !== 'player' && value !== 'ai') reject(STATE);
    reject(UNSUPPORTED);
  }
  // Card uid -> turn number the card entered the field.
  for (const name of OPTIONAL_ROOT.turnTable) {
    if (!Object.hasOwn(state, name)) continue;
    const table = own(state, name, STATE);
    ordinary(table, STATE);
    copyJson(table, STATE);
    for (const key of Reflect.ownKeys(table)) {
      const turn = own(table, key, STATE);
      if (!nonempty(key) || !Number.isSafeInteger(turn) || turn < 0 || Object.is(turn, -0)) reject(STATE);
    }
  }
}

function validatePlayerMarkers(state) {
  for (const name of OPTIONAL_ROOT.player) {
    if (!Object.hasOwn(state, name)) continue;
    const value = own(state, name, STATE);
    if (value !== 'player' && value !== 'ai') reject(STATE);
  }
}

function idleState(state) {
  const mode = own(state, 'mode', STATE);
  if (typeof mode !== 'string' || !['ai', 'tutorial', 'lab', 'sandbox'].includes(mode)) reject(STATE);
  if (['lab', 'sandbox'].includes(mode)) reject(UNSUPPORTED);
  const phase = own(state, 'phase', STATE);
  const interactive = own(state, 'interactive', STATE);
  const processing = own(state, 'processingTriggers', STATE);
  const resolving = own(state, 'resolvingResponse', STATE);
  const depth = own(state, 'effectDepth', STATE);
  if (typeof phase !== 'string' || typeof interactive !== 'boolean' || typeof processing !== 'boolean'
    || typeof resolving !== 'boolean' || !Number.isSafeInteger(depth) || depth < 0) reject(STATE);
  if (phase !== 'main' || processing || resolving || depth !== 0) reject(UNSUPPORTED);
  for (const key of ['effectResolution', 'mandatoryDrawContinuation', 'resolvingDeclaredEffect', 'deferredDeclaredResponseCleanup',
    'deferredDeclaredScriptCleanup', 'placementCostBatch', 'triggerThread', 'threadNotice', 'selectedUid', 'openAdmin', 'pending', 'prompt']) {
    if (own(state, key, STATE) !== null) reject(UNSUPPORTED);
  }
  for (const key of ['selectionQueue', 'victoryFacts', 'scriptActivationQueue', 'triggerQueue', 'delayedEffects', 'declaredEffects', 'responseEventQueue']) {
    if (dense(own(state, key, STATE), STATE).length) reject(UNSUPPORTED);
  }
  const victory = own(state, 'victory', STATE);
  if (typeof own(victory, 'finished', STATE) !== 'boolean') reject(STATE);
  validateOptionalRoot(state);
}

export function snapshotState(state, metadata, referenceState, revision) {
  validatePlayerMarkers(state);
  try {
    idleState(state);
    return;
  } catch (error) {
    if (!(error instanceof SnapshotError) || error.code !== UNSUPPORTED) throw error;
  }
  const mode = own(state, 'mode', STATE);
  const phase = own(state, 'phase', STATE);
  const processing = own(state, 'processingTriggers', STATE);
  const resolving = own(state, 'resolvingResponse', STATE);
  const depth = own(state, 'effectDepth', STATE);
  if (!['ai', 'tutorial'].includes(mode) || phase !== 'main'
    || processing !== false || resolving !== false || depth !== 0) reject(UNSUPPORTED);
  const required = buildRequiredInput({ metadata, revision, engineState: state, referenceState }, metadata.seatIds[0]);
  if (!required.ok || required.value === null) reject(UNSUPPORTED);
}

export function stateData(input, { rootCode = INVALID, busy = true, live = false, runtime = true } = {}) {
  const state = allowedRootKeys(input, rootCode, live);
  if (busy) idleState(state);
  if (!runtime) return state;
  return runtimeData(state);
}

export function runtimeData(state) {
  const runtime = exact(state.runtimeContext, CONTEXT_KEYS, STATE);
  if (!nonempty(runtime.matchId)) reject(STATE);
  runtime.seatIds = seatIds(runtime.seatIds, STATE);
  const rng = restoreRngState(runtime.rngState);
  if (!rng.ok) reject(rng.error.code === 'RNG_UNSUPPORTED_FORMAT' ? FORMAT_ERROR : STATE);
  state.runtimeContext = runtime;
  return state;
}

export function validateRootNumbers(state, descriptorCode = STATE) {
  for (const key of ['projectionSerial', 'selectionQueueSerial', 'legacyProjectionOwnerSerial', 'effectSerial', 'tokenSerial', 'triggerSerial', 'declarationSerial']) {
    const value = own(state, key, descriptorCode);
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) reject(STATE);
  }
  const turnNumber = own(state, 'turnNumber', descriptorCode);
  if (!Number.isSafeInteger(turnNumber) || turnNumber <= 0 || Object.is(turnNumber, -0)) reject(STATE);
  const revisions = own(state, 'projectionSlotRevision', descriptorCode);
  const pending = own(revisions, 'pending', descriptorCode);
  const prompt = own(revisions, 'prompt', descriptorCode);
  for (const value of [pending, prompt]) if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) reject(STATE);
}
