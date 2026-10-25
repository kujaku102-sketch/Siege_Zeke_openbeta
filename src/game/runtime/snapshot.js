import { cloneForHistory, DECK_OPTIONS } from '../engine.js';
import { CARD_LIBRARY, USER_CARDS } from '../../data/cards.js';
import { buildRuntimeIdentityIndex } from './bridge.js';
import { planRuntimeReferenceTransition } from './references.js';
import { queryRuntimeSeat, queryRuntimeCard } from './query.js';
import { projectRuntimeView } from './projection.js';
import { restoreRngState } from './rng.js';
import { buildRequiredInput } from './required-input.js';

const FORMAT = 'siege-zeke.authority-snapshot';
const SNAPSHOT_KEYS = ['format', 'schemaVersion', 'metadata', 'revision', 'engineState', 'referenceState'];
const META_KEYS = ['matchId', 'seatIds', 'ruleVersion', 'cardVersion', 'startOptions'];
const OPTION_KEYS = ['mode', 'tutorialId', 'playerDeckId', 'aiDeckId', 'playerDeckRecipe', 'aiDeckRecipe', 'playerUserId', 'aiUserId', 'sandboxDeckSetup'];
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
const INVALID = 'SNAPSHOT_INVALID_INPUT';
const UNSUPPORTED = 'SNAPSHOT_UNSUPPORTED_STATE';
const FORMAT_ERROR = 'SNAPSHOT_UNSUPPORTED_FORMAT';
const SCOPE = 'SNAPSHOT_SCOPE_MISMATCH';
const VERSION = 'SNAPSHOT_VERSION_MISMATCH';
const STATE = 'SNAPSHOT_INVALID_STATE';
const NOT_READY = 'SNAPSHOT_REFERENCE_NOT_READY';
const MISSING = Symbol('missing');
class SnapshotError extends Error { constructor(code) { super(code); this.code = code; } }
const reject = code => { throw new SnapshotError(code); };
const nonempty = value => typeof value === 'string' && value.length > 0;

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
  return Object.fromEntries(keys.map(key => [key, own(value, key, code)]));
}

function snapshotEnvelope(input) {
  if (input === null || (typeof input !== 'object')) reject(INVALID);
  if (Array.isArray(input)) {
    dense(input, INVALID);
    reject(FORMAT_ERROR);
  }
  ordinary(input, INVALID);
  const keys = Reflect.ownKeys(input);
  for (const key of keys) {
    if (typeof key !== 'string') reject(INVALID);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(INVALID);
  }
  if (!keys.includes('format')) reject(FORMAT_ERROR);
  const format = own(input, 'format', INVALID);
  if (typeof format !== 'string') reject(INVALID);
  if (format !== FORMAT) reject(FORMAT_ERROR);
  if (!keys.includes('schemaVersion')) reject(INVALID);
  const schemaVersion = own(input, 'schemaVersion', INVALID);
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || Object.is(schemaVersion, -0) || schemaVersion < 0) reject(INVALID);
  if (schemaVersion !== 1) reject(FORMAT_ERROR);
  return exact(input, SNAPSHOT_KEYS, INVALID);
}

function dense(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const result = [];
  for (let i = 0; i < length.value; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    result.push(descriptor.value);
  }
  return result;
}

function copyJson(value, code, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) reject(code);
    return value;
  }
  if (typeof value !== 'object') reject(code);
  if (ancestors.has(value)) reject(code);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return dense(value, code).map(item => copyJson(item, code, ancestors));
    ordinary(value, code);
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') reject(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, code, ancestors), enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

function seatIds(value, code) {
  const ids = dense(value, code);
  if (ids.length !== 2 || !ids.every(nonempty) || ids[0] === ids[1]) reject(code);
  return ids;
}

const defaults = {
  mode: 'ai', tutorialId: 'basics', playerDeckId: 'red', aiDeckId: 'yellow', playerDeckRecipe: null, aiDeckRecipe: null,
  playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
};

function recipeData(input, code) {
  if (input === null) return null;
  const rows = dense(input, code);
  let total = 0;
  return rows.map(row => {
    const pair = dense(row, code);
    if (pair.length !== 2 || typeof pair[0] !== 'string' || !Object.hasOwn(CARD_LIBRARY, pair[0])
      || !Number.isSafeInteger(pair[1]) || pair[1] <= 0 || Object.is(pair[1], -0)) reject(code);
    total += pair[1];
    if (!Number.isSafeInteger(total)) reject(code);
    return [pair[0], pair[1]];
  });
}

function optionsData(input, code) {
  // Stored only for v2.4 matches; a legacy match's options keep exactly the nine original keys.
  ordinary(input, code);
  const supplied = exact(input, Object.hasOwn(input, 'openingProtocol') ? [...OPTION_KEYS, 'openingProtocol'] : OPTION_KEYS, code);
  const result = { ...defaults, ...supplied };
  if (typeof result.mode !== 'string' || !['ai', 'tutorial', 'lab', 'sandbox'].includes(result.mode)) reject(code);
  if (['lab', 'sandbox'].includes(result.mode)) reject(UNSUPPORTED);
  if (!['basics', 'vengeance'].includes(result.tutorialId)) reject(code);
  for (const key of ['playerDeckId', 'aiDeckId']) if (typeof result[key] !== 'string' || !Object.hasOwn(DECK_OPTIONS, result[key])) reject(code);
  for (const key of ['playerUserId', 'aiUserId']) if (typeof result[key] !== 'string' || !Object.hasOwn(USER_CARDS, result[key])) reject(code);
  if (typeof result.sandboxDeckSetup !== 'boolean') reject(code);
  if (Object.hasOwn(result, 'openingProtocol') && (result.openingProtocol !== 'v2.4' || result.mode !== 'ai')) reject(code);
  for (const key of ['playerDeckRecipe', 'aiDeckRecipe']) result[key] = recipeData(result[key], code);
  if (result.mode === 'tutorial') {
    const vengeance = result.tutorialId === 'vengeance';
    const playerRecipe = result.playerDeckRecipe ?? DECK_OPTIONS[vengeance ? 'vengeance' : result.playerDeckId].recipe;
    const aiRecipe = result.aiDeckRecipe ?? DECK_OPTIONS[result.aiDeckId].recipe;
    const contains = (rows, ids) => ids.every(id => rows.some(([definition, count]) => definition === id && count > 0));
    if (!vengeance && !contains(playerRecipe, ['STD-076', 'STD-075', 'STD-090', 'STD-086'])) reject(code);
    if (!contains(aiRecipe, vengeance ? ['STD-125', 'STD-131', 'STD-149'] : ['STD-125', 'STD-131', 'STD-149', 'STD-129', 'STD-138'])) reject(code);
  }
  return result;
}

function metadataData(input, code) {
  const metadata = exact(input, META_KEYS, code);
  if (!nonempty(metadata.matchId) || !nonempty(metadata.ruleVersion) || !nonempty(metadata.cardVersion)) reject(code);
  metadata.seatIds = seatIds(metadata.seatIds, code);
  metadata.startOptions = optionsData(metadata.startOptions, code);
  return metadata;
}

function allowedRootKeys(input, code, live) {
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
  for (const key of ['selectionQueue', 'victoryFacts', 'activationWindows', 'scriptActivationQueue', 'triggerQueue', 'delayedEffects', 'declaredEffects', 'responseEventQueue']) {
    if (dense(own(state, key, STATE), STATE).length) reject(UNSUPPORTED);
  }
  const victory = own(state, 'victory', STATE);
  if (typeof own(victory, 'finished', STATE) !== 'boolean') reject(STATE);
  validateOptionalRoot(state);
}

function snapshotState(state, metadata, referenceState, revision) {
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

function stateData(input, { rootCode = INVALID, busy = true, live = false, runtime = true } = {}) {
  const state = allowedRootKeys(input, rootCode, live);
  if (busy) idleState(state);
  if (!runtime) return state;
  return runtimeData(state);
}

function runtimeData(state) {
  const runtime = exact(state.runtimeContext, CONTEXT_KEYS, STATE);
  if (!nonempty(runtime.matchId)) reject(STATE);
  runtime.seatIds = seatIds(runtime.seatIds, STATE);
  const rng = restoreRngState(runtime.rngState);
  if (!rng.ok) reject(rng.error.code === 'RNG_UNSUPPORTED_FORMAT' ? FORMAT_ERROR : STATE);
  state.runtimeContext = runtime;
  return state;
}

function validateRootNumbers(state, descriptorCode = STATE) {
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

function sameArray(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function effectiveDeck(options) { return options.mode === 'tutorial' && options.tutorialId === 'vengeance' ? 'vengeance' : options.playerDeckId; }

function consistency(metadata, state, revision) {
  const runtime = state.runtimeContext;
  if (!Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) reject(INVALID);
  if (runtime.matchId !== metadata.matchId || !sameArray(runtime.seatIds, metadata.seatIds)) reject(SCOPE);
  if (state.mode !== metadata.startOptions.mode || state.tutorialId !== metadata.startOptions.tutorialId
    || state.playerDeckId !== effectiveDeck(metadata.startOptions) || state.aiDeckId !== metadata.startOptions.aiDeckId
    || state.playerUserId !== metadata.startOptions.playerUserId || state.aiUserId !== metadata.startOptions.aiUserId) reject(STATE);
}

function physicalCards(state) {
  const found = new Map();
  const visit = card => {
    const identity = own(card, 'identity', UNSUPPORTED);
    const id = own(identity, 'instanceId', UNSUPPORTED);
    found.set(id, card);
    for (const child of dense(own(card, 'mounted', UNSUPPORTED), UNSUPPORTED)) visit(child);
  };
  const players = own(state, 'players', UNSUPPORTED);
  for (const owner of ['player', 'ai']) {
    const player = own(players, owner, UNSUPPORTED);
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban', 'virtual']) {
      const value = own(player, zone, UNSUPPORTED, true);
      if (value !== MISSING) for (const card of dense(value, UNSUPPORTED)) visit(card);
    }
  }
  return found;
}

function checkRuntime(state, references, metadata, revision) {
  consistency(metadata, state, revision);
  const built = buildRuntimeIdentityIndex(state);
  if (!built.ok) reject(STATE);
  const physical = physicalCards(state);
  const frame = {
    matchId: built.value.matchId,
    seatIds: [...metadata.seatIds],
    cards: built.value.entries.map(entry => {
      const card = physical.get(entry.identity.instanceId);
      if (!card) reject(STATE);
      const faceDown = own(card, 'faceDown', STATE, true);
      if (faceDown !== MISSING && typeof faceDown !== 'boolean') reject(STATE);
      return { ...entry, faceDown: faceDown === true };
    })
  };
  const plan = planRuntimeReferenceTransition(references, { beforeFrame: frame, afterFrame: frame });
  if (!plan.ok) {
    if (plan.error.code === 'REF_INVALID_TRANSITION') reject(NOT_READY);
    if (plan.error.code === 'REF_INVALID_FRAME') reject(SCOPE);
    reject(STATE);
  }
  if (plan.value.invalidatedIdentities.length || plan.value.newRefCount) reject(NOT_READY);
  for (const seatId of metadata.seatIds) if (!queryRuntimeSeat(state, { seatId }).ok) reject(STATE);
  for (const entry of built.value.entries.slice(0, 1)) {
    if (!queryRuntimeCard(state, { identity: entry.identity, keywordNames: [] }).ok) reject(STATE);
  }
  for (const viewerSeat of metadata.seatIds) {
    const result = projectRuntimeView(state, references, { matchId: metadata.matchId, viewerSeat, revision });
    if (!result.ok && result.error.code === 'PROJECTION_SCOPE_MISMATCH') reject(SCOPE);
    if (!result.ok) reject(result.error.code === 'PROJECTION_REFERENCE_NOT_READY' ? NOT_READY : STATE);
  }
}

function envelope(code, action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof SnapshotError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function createRuntimeSnapshot(input) {
  return envelope(INVALID, () => {
    const args = exact(input, ['metadata', 'revision', 'engineState', 'referenceState'], INVALID);
    const metadata = metadataData(args.metadata, INVALID);
    const liveState = allowedRootKeys(args.engineState, UNSUPPORTED, true);
    validateRootNumbers(liveState);
    const engineState = copyJson(liveState, UNSUPPORTED);
    const state = stateData(engineState, { rootCode: UNSUPPORTED, busy: false });
    const referenceState = copyJson(args.referenceState, STATE);
    snapshotState(state, metadata, referenceState, args.revision);
    consistency(metadata, state, args.revision);
    checkRuntime(state, referenceState, metadata, args.revision);
    return {
      format: FORMAT, schemaVersion: 1, metadata: copyJson(metadata, UNSUPPORTED), revision: args.revision,
      engineState, referenceState
    };
  });
}

export function restoreRuntimeSnapshot(snapshot, expected) {
  return envelope(INVALID, () => {
    const binding = exact(expected, ['matchId', 'seatIds', 'ruleVersion', 'cardVersion'], INVALID);
    binding.seatIds = seatIds(binding.seatIds, INVALID);
    if (!nonempty(binding.matchId) || !nonempty(binding.ruleVersion) || !nonempty(binding.cardVersion)) reject(INVALID);
    const raw = snapshotEnvelope(snapshot);
    const revision = raw.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) reject(INVALID);
    validateRootNumbers(raw.engineState, INVALID);
    const rawMetadata = copyJson(raw.metadata, INVALID);
    const references = copyJson(raw.referenceState, INVALID);
    const copiedState = copyJson(raw.engineState, INVALID);
    const metadata = metadataData(rawMetadata, INVALID);
    const state = stateData(copiedState, { rootCode: UNSUPPORTED, runtime: false, busy: false });
    if (binding.matchId !== metadata.matchId || !sameArray(binding.seatIds, metadata.seatIds)) reject(SCOPE);
    if (binding.ruleVersion !== metadata.ruleVersion || binding.cardVersion !== metadata.cardVersion) reject(VERSION);
    runtimeData(state);
    snapshotState(state, metadata, references, revision);
    consistency(metadata, state, revision);
    checkRuntime(state, references, metadata, revision);
    const restored = cloneForHistory({ ...state, rng: null, history: [] });
    validateRootNumbers(restored);
    const rng = restoreRngState(restored.runtimeContext.rngState);
    if (!rng.ok) reject(rng.error.code === 'RNG_UNSUPPORTED_FORMAT' ? FORMAT_ERROR : STATE);
    snapshotState(restored, metadata, references, revision);
    consistency(metadata, restored, revision);
    checkRuntime(restored, references, metadata, revision);
    return { metadata: copyJson(metadata, INVALID), revision, engineState: restored, referenceState: references };
  });
}
