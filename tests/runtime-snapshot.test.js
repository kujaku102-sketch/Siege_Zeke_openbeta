import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { startTurn } from '../src/game/engine.js';
import { buildRuntimeIdentityIndex } from '../src/game/runtime/bridge.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { projectRuntimeView } from '../src/game/runtime/projection.js';
import { createRuntimeSnapshot, restoreRuntimeSnapshot } from '../src/game/runtime/snapshot.js';
import { allocateInstanceId } from '../src/game/runtime/identity.js';
import { nextRng } from '../src/game/runtime/rng.js';

const config = { matchId: 'snapshot-match', seatIds: ['seat-a', 'seat-b'], seed: 7, ruleVersion: 'rules-1', cardVersion: 'cards-1', gameOptions: { playerDeckRecipe: [], aiDeckRecipe: [] } };
function session(overrides = {}) {
  const result = createRuntimeSession({ ...config, ...overrides });
  assert.equal(result.ok, true);
  return result.value;
}
function references(engineState) {
  const built = buildRuntimeIdentityIndex(engineState);
  assert.equal(built.ok, true);
  const physical = new Map();
  const visit = card => { physical.set(card.identity.instanceId, card); for (const child of card.mounted ?? []) visit(child); };
  for (const owner of ['player', 'ai']) for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban', 'virtual']) {
    for (const card of engineState.players[owner][zone] ?? []) visit(card);
  }
  const frame = { matchId: built.value.matchId, seatIds: [...engineState.runtimeContext.seatIds], cards: built.value.entries.map(entry => ({
    ...entry, faceDown: physical.get(entry.identity.instanceId)?.faceDown === true
  })) };
  const entries = new Map(frame.cards.map(entry => [entry.identity.instanceId, entry]));
  const trackable = (entry, viewer) => {
    let current = entry;
    while (current.location.kind === 'mounted') {
      if (current.faceDown) return false;
      current = entries.get(current.location.host.instanceId);
      if (!current) return false;
    }
    if (current.location.kind === 'board') return true;
    if (current.location.kind !== 'zone') return false;
    if (current.location.zone === 'hand') return current.controllerSeat === viewer;
    return ['registry', 'trash', 'ban'].includes(current.location.zone) && !current.faceDown;
  };
  const count = frame.cards.reduce((sum, entry) => sum + frame.seatIds.filter(viewer => trackable(entry, viewer)).length, 0);
  const tokens = Array.from({ length: count }, (_, index) => `r:${String(index + 1).padStart(32, '0')}`);
  const result = createRuntimeReferenceState({ frame, newRefs: tokens });
  assert.equal(result.ok, true);
  return result.value;
}
function input(current = session()) {
  return { metadata: current.metadata, revision: current.revision, engineState: current.engineState, referenceState: references(current.engineState) };
}
function cardInput() { return input(session({ gameOptions: { mode: 'tutorial' } })); }
function create(currentInput = input()) {
  const result = createRuntimeSnapshot(currentInput);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
const binding = { matchId: config.matchId, seatIds: config.seatIds, ruleVersion: config.ruleVersion, cardVersion: config.cardVersion };
const restore = snapshot => restoreRuntimeSnapshot(snapshot, binding);
const rejects = (result, code) => assert.deepEqual(result, { ok: false, error: { code } });
function deepFreeze(value, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  return Object.freeze(value);
}

test('S02-SNAPSHOT-01: canonical envelope, omitted runtime functions/history, and independent restore', () => {
  const source = input();
  const snapshot = create(source);
  assert.deepEqual(Object.keys(snapshot), ['format', 'schemaVersion', 'metadata', 'revision', 'engineState', 'referenceState']);
  assert.equal(snapshot.format, 'siege-zeke.authority-snapshot');
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.engineState.interactive, true);
  assert.equal(Object.hasOwn(snapshot.engineState, 'rng'), false);
  assert.equal(Object.hasOwn(snapshot.engineState, 'history'), false);
  const restored = restore(snapshot);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.deepEqual(restored.value.engineState.runtimeContext, source.engineState.runtimeContext);
  assert.equal(typeof restored.value.engineState.rng, 'function');
  assert.equal(restored.value.engineState.interactive, true);
  assert.deepEqual(restored.value.engineState.history, []);
  assert.notEqual(restored.value.engineState, source.engineState);
  assert.notEqual(restored.value.engineState.runtimeContext, source.engineState.runtimeContext);
  assert.notEqual(restored.value.referenceState, source.referenceState);
  const badHistory = input(); badHistory.engineState.history.push({ old: true });
  rejects(createRuntimeSnapshot(badHistory), 'SNAPSHOT_UNSUPPORTED_STATE');
  const accessorHistory = input();
  let getterCalls = 0;
  Object.defineProperty(accessorHistory.engineState, 'history', { enumerable: true, get() { getterCalls += 1; return []; } });
  rejects(createRuntimeSnapshot(accessorHistory), 'SNAPSHOT_UNSUPPORTED_STATE');
  assert.equal(getterCalls, 0);
  const malformedHistory = input(); malformedHistory.engineState.history.extra = true;
  rejects(createRuntimeSnapshot(malformedHistory), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-02: preserves unknown nested JSON values and independently copies shared branches', () => {
  const source = input();
  const shared = { vendor: ['kept'] };
  source.engineState.victory.extraA = shared;
  source.engineState.victory.extraB = shared;
  const restored = restore(create(source));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.value.engineState.victory.extraA, shared);
  assert.notEqual(restored.value.engineState.victory.extraA, restored.value.engineState.victory.extraB);
  restored.value.engineState.victory.extraA.vendor.push('changed');
  assert.deepEqual(restored.value.engineState.victory.extraB.vendor, ['kept']);
});

test('S02-SNAPSHOT-03: accepts the vengeance deck override without a false deck-id mismatch', () => {
  const current = session({ gameOptions: { mode: 'tutorial', tutorialId: 'vengeance' } });
  const refs = references(current.engineState);
  const result = createRuntimeSnapshot({ ...current, referenceState: refs });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.metadata.startOptions.playerDeckId, 'red');
  assert.equal(result.value.engineState.playerDeckId, 'vengeance');
});

test('S02-SNAPSHOT-04: rejects unsupported modes and busy engine states', () => {
  const lab = session({ gameOptions: { mode: 'lab' } });
  rejects(createRuntimeSnapshot({ ...lab, referenceState: references(lab.engineState) }), 'SNAPSHOT_UNSUPPORTED_STATE');
  const busy = input();
  busy.engineState.pending = { type: 'choice' };
  rejects(createRuntimeSnapshot(busy), 'SNAPSHOT_UNSUPPORTED_STATE');
  const triggered = input();
  triggered.engineState.triggerQueue.push({ id: 'work' });
  rejects(createRuntimeSnapshot(triggered), 'SNAPSHOT_UNSUPPORTED_STATE');
  const selecting = input();
  selecting.engineState.selectionQueue.push({ id: 'selection' });
  rejects(createRuntimeSnapshot(selecting), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-05: requires exact start option and snapshot root shapes', () => {
  const badOptions = input();
  badOptions.metadata.startOptions.extra = 1;
  rejects(createRuntimeSnapshot(badOptions), 'SNAPSHOT_INVALID_INPUT');
  const extraRoot = input();
  extraRoot.engineState.unreviewed = true;
  rejects(createRuntimeSnapshot(extraRoot), 'SNAPSHOT_UNSUPPORTED_STATE');
  const malformed = create();
  malformed.unreviewed = true;
  rejects(restore(malformed), 'SNAPSHOT_INVALID_INPUT');
});

test('S02-SNAPSHOT-06: strict copy rejects unsupported values and never invokes accessors', () => {
  for (const value of [Symbol('x'), () => 1, 1n, NaN, Infinity, -0, new Map(), new Set(), new Date(), Object.create({ inherited: true })]) {
    const current = input();
    current.engineState.victory.bad = value;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_UNSUPPORTED_STATE');
  }
  const getter = input();
  let calls = 0;
  Object.defineProperty(getter.engineState.victory, 'bad', { enumerable: true, get() { calls += 1; return 1; } });
  rejects(createRuntimeSnapshot(getter), 'SNAPSHOT_UNSUPPORTED_STATE');
  assert.equal(calls, 0);
});

test('S02-SNAPSHOT-06b: saving leaves out a field without a value (as JSON does); loading still refuses one', () => {
  const current = input();
  current.engineState.victory.bad = undefined;
  current.engineState.log.push({ id: 'x', text: 'y', color: undefined });
  const snapshot = create(current);
  assert.equal(Object.hasOwn(snapshot.engineState.victory, 'bad'), false);
  assert.equal(Object.hasOwn(snapshot.engineState.log.at(-1), 'color'), false);
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify(snapshot)));
  assert.equal(restore(JSON.parse(JSON.stringify(snapshot))).ok, true);
  const loaded = structuredClone(snapshot);
  loaded.engineState.victory.bad = undefined;
  rejects(restore(loaded), 'SNAPSHOT_INVALID_INPUT');
  const inArray = input();
  inArray.engineState.log.push({ id: 'x', text: 'y', parts: [undefined] });
  rejects(createRuntimeSnapshot(inArray), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-07: strict arrays reject holes, extras, accessors, and cycles', () => {
  const hole = input(); hole.engineState.log = Array(1);
  rejects(createRuntimeSnapshot(hole), 'SNAPSHOT_UNSUPPORTED_STATE');
  const extra = input(); extra.engineState.log.extra = true;
  rejects(createRuntimeSnapshot(extra), 'SNAPSHOT_UNSUPPORTED_STATE');
  const arrayGetter = input();
  let calls = 0;
  Object.defineProperty(arrayGetter.engineState.log, '0', { enumerable: true, get() { calls += 1; return 'x'; } });
  rejects(createRuntimeSnapshot(arrayGetter), 'SNAPSHOT_UNSUPPORTED_STATE');
  assert.equal(calls, 0);
  const cycle = input(); cycle.engineState.victory.self = cycle.engineState.victory;
  rejects(createRuntimeSnapshot(cycle), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-08: create validates current references and does not issue or repair them', () => {
  const current = input();
  const before = structuredClone(current.referenceState);
  const snapshot = create(current);
  assert.deepEqual(current.referenceState, before);
  assert.deepEqual(snapshot.referenceState, before);
  const wrong = input();
  wrong.referenceState.matchId = 'other-match';
  rejects(createRuntimeSnapshot(wrong), 'SNAPSHOT_SCOPE_MISMATCH');
});

test('S02-SNAPSHOT-09: revision and metadata are bound and preserved', () => {
  const current = input(); current.revision = 3;
  const snapshot = create(current);
  assert.equal(snapshot.revision, 3);
  assert.equal(restore(snapshot).value.revision, 3);
  rejects(restoreRuntimeSnapshot(snapshot, { ...binding, matchId: 'other' }), 'SNAPSHOT_SCOPE_MISMATCH');
  for (const revision of [-1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = input(); invalid.revision = revision;
    rejects(createRuntimeSnapshot(invalid), 'SNAPSHOT_INVALID_INPUT');
  }
});

test('S02-SNAPSHOT-10: malformed serialized state and strict JSON violations fail restore', () => {
  const snapshot = create();
  const extra = structuredClone(snapshot); extra.engineState.extra = true;
  rejects(restore(extra), 'SNAPSHOT_UNSUPPORTED_STATE');
  const negativeZero = structuredClone(snapshot); negativeZero.engineState.turnNumber = -0;
  rejects(restore(negativeZero), 'SNAPSHOT_INVALID_STATE');
  rejects(restore({ ...snapshot, schemaVersion: 2 }), 'SNAPSHOT_UNSUPPORTED_FORMAT');
  rejects(restore({ ...snapshot, referenceState: undefined }), 'SNAPSHOT_INVALID_INPUT');
});

test('S02-SNAPSHOT-11: RNG closure advances the restored context, not the source', () => {
  const source = input();
  const snapshot = create(source);
  const restored = restore(snapshot).value.engineState;
  const beforeSource = source.engineState.runtimeContext.rngState.draws;
  const beforeRestored = restored.runtimeContext.rngState.draws;
  restored.rng();
  assert.equal(restored.runtimeContext.rngState.draws, beforeRestored + 1);
  assert.equal(source.engineState.runtimeContext.rngState.draws, beforeSource);
});

test('S02-SNAPSHOT-12: rejects invalid required RNG state before snapshot creation', () => {
  const current = input();
  current.engineState.runtimeContext.rngState.cursor += 1;
  rejects(createRuntimeSnapshot(current), 'SNAPSHOT_INVALID_STATE');
  const missing = input();
  delete missing.engineState.runtimeContext.rngState;
  rejects(createRuntimeSnapshot(missing), 'SNAPSHOT_INVALID_STATE');
});

test('S02-SNAPSHOT-13: metadata and expected restore binding require exact fields', () => {
  const snapshot = create();
  rejects(restoreRuntimeSnapshot(snapshot, { ...binding, extra: true }), 'SNAPSHOT_INVALID_INPUT');
  const missingSeat = { ...binding }; delete missingSeat.seatIds;
  rejects(restoreRuntimeSnapshot(snapshot, missingSeat), 'SNAPSHOT_INVALID_INPUT');
  const badMeta = structuredClone(snapshot); badMeta.metadata.startOptions.extra = true;
  rejects(restore(badMeta), 'SNAPSHOT_INVALID_INPUT');
});

test('S02-SNAPSHOT-14: nested symbols and non-enumerable object fields are rejected', () => {
  const symbol = input(); symbol.engineState.victory[Symbol('secret')] = 1;
  rejects(createRuntimeSnapshot(symbol), 'SNAPSHOT_UNSUPPORTED_STATE');
  const hidden = input();
  Object.defineProperty(hidden.engineState.victory, 'hidden', { value: true, enumerable: false });
  rejects(createRuntimeSnapshot(hidden), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-15: arrays reject symbols and non-enumerable additions', () => {
  const symbol = input(); symbol.engineState.log[Symbol('extra')] = 1;
  rejects(createRuntimeSnapshot(symbol), 'SNAPSHOT_UNSUPPORTED_STATE');
  const hidden = input();
  Object.defineProperty(hidden.engineState.log, 'extra', { value: 1, enumerable: false });
  rejects(createRuntimeSnapshot(hidden), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-16: restore never accepts live-only RNG or history properties', () => {
  const snapshot = create();
  const history = structuredClone(snapshot); history.engineState.history = [];
  rejects(restore(history), 'SNAPSHOT_UNSUPPORTED_STATE');
  const rng = structuredClone(snapshot); rng.engineState.rng = null;
  rejects(restore(rng), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-17: state and references in the emitted snapshot are detached', () => {
  const source = input();
  const snapshot = create(source);
  snapshot.engineState.victory.lockedOutcome = 'edited';
  snapshot.metadata.seatIds[0] = 'edited';
  snapshot.referenceState.seatIds[0] = 'edited';
  assert.equal(source.engineState.victory.lockedOutcome, null);
  assert.equal(source.metadata.seatIds[0], 'seat-a');
  assert.equal(source.referenceState.seatIds[0], 'seat-a');
});

test('S02-SNAPSHOT-18: tutorial IDs and all nine start option keys are retained', () => {
  const snapshot = create();
  assert.deepEqual(Object.keys(snapshot.metadata.startOptions), [
    'mode', 'tutorialId', 'playerDeckId', 'aiDeckId', 'playerDeckRecipe', 'aiDeckRecipe',
    'playerUserId', 'aiUserId', 'sandboxDeckSetup'
  ]);
  assert.equal(snapshot.metadata.startOptions.tutorialId, 'basics');
});

test('S02-SNAPSHOT-19: reference scope and identity-index inconsistencies are rejected', () => {
  const wrongRefs = input();
  wrongRefs.referenceState.matchId = 'foreign';
  rejects(createRuntimeSnapshot(wrongRefs), 'SNAPSHOT_SCOPE_MISMATCH');
  const wrongRuntime = input();
  wrongRuntime.engineState.runtimeContext.identityState.matchId = 'foreign';
  rejects(createRuntimeSnapshot(wrongRuntime), 'SNAPSHOT_INVALID_STATE');
});

test('S02-SNAPSHOT-20: restored metadata, references, and nested state do not alias snapshot data', () => {
  const snapshot = create();
  const restored = restore(snapshot);
  assert.equal(restored.ok, true);
  restored.value.engineState.victory.finished = true;
  restored.value.metadata.seatIds[0] = 'changed';
  restored.value.referenceState.seatIds[0] = 'changed';
  assert.equal(snapshot.engineState.victory.finished, false);
  assert.equal(snapshot.metadata.seatIds[0], 'seat-a');
  assert.equal(snapshot.referenceState.seatIds[0], 'seat-a');
});

test('S02-SNAPSHOT-21: preserves JSON keys named __proto__ as data', () => {
  const source = input();
  Object.defineProperty(source.engineState.victory, '__proto__', { value: { retained: true }, enumerable: true, writable: true, configurable: true });
  const restored = restore(create(source));
  assert.equal(restored.ok, true);
  assert.equal(Object.getPrototypeOf(restored.value.engineState.victory), Object.prototype);
  assert.equal(Object.hasOwn(restored.value.engineState.victory, '__proto__'), true);
  assert.deepEqual(restored.value.engineState.victory.__proto__, { retained: true });
});

test('S02-SNAPSHOT-22: JSON stringify/parse roundtrip restores a valid independent authority snapshot', () => {
  const snapshot = create(cardInput());
  const parsed = JSON.parse(JSON.stringify(snapshot));
  const result = restore(parsed);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value.engineState.players, snapshot.engineState.players);
  assert.deepEqual(result.value.referenceState, snapshot.referenceState);
});

test('S02-SNAPSHOT-23: next RNG value and state match the saved runtime cursor', () => {
  const snapshot = create();
  const expected = nextRng(snapshot.engineState.runtimeContext.rngState);
  const restored = restore(snapshot).value.engineState;
  const actual = restored.rng();
  assert.equal(actual, expected.value.value);
  assert.deepEqual(restored.runtimeContext.rngState, expected.value.state);
});

test('S02-SNAPSHOT-24: next identity allocation matches the saved ledger', () => {
  const snapshot = create();
  const expected = allocateInstanceId(snapshot.engineState.runtimeContext.identityState);
  const restored = restore(snapshot).value.engineState;
  const actual = allocateInstanceId(restored.runtimeContext.identityState);
  assert.deepEqual(actual, expected);
});

test('S02-SNAPSHOT-25: completed victory outcome and winner survive roundtrip', () => {
  const current = session({ gameOptions: { mode: 'tutorial' } });
  const state = current.engineState;
  state.players.player.trash.push(...state.players.player.deck.splice(0));
  state.players.player.turnsTaken = 1;
  startTurn(state, 'player');
  assert.equal(state.victory.finished, true);
  assert.equal(state.winner, 'ai');
  const result = restore(create({ ...current, referenceState: references(state) }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.engineState.victory.finished, true);
  assert.equal(result.value.engineState.victory.lockedOutcome, 'ai');
  assert.equal(result.value.engineState.winner, 'ai');
});

test('S02-SNAPSHOT-26: permits exactly the declared idle optional-root values and preserves them', () => {
  const current = input();
  Object.assign(current.engineState, {
    deferredAttack: null, deferredDestruction: null, deferredSpellCleanup: null, std230AmbushCleanup: null,
    securityRestWindow: null, attackResumeStage: null, std094TurnEndQueue: null, std141TurnEndQueue: null,
    std142TurnEndQueue: null, std142DestroyBatch: null, std211DestructionBatch: null,
    deferredTrashMoves: [], destroyLkiFollowUps: [], independentEffects: [],
    runtimeDestructionContinuations: {}, std142DestructionContinuations: {}, std211DestructionContinuations: {},
    drainingIndependentEffects: false, resolvingStd165: false, skipSavageTurnEnd: false
  });
  const snapshot = create(current);
  const restored = restore(snapshot);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.value.engineState.independentEffects, []);
  assert.deepEqual(restored.value.engineState.runtimeDestructionContinuations, {});
});

test('S02-SNAPSHOT-27: preserves nonempty provisional data but rejects busy optional-root values', () => {
  const current = input(); current.engineState.provisional.push({ retained: true });
  assert.equal(create(current).engineState.provisional.length, 1);
  const busy = input(); busy.engineState.std142DestroyBatch = {};
  rejects(createRuntimeSnapshot(busy), 'SNAPSHOT_UNSUPPORTED_STATE');
  const unknown = input(); unknown.engineState.newLifecycleFlag = null;
  rejects(createRuntimeSnapshot(unknown), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-28: returns distinct input, format, scope, version, and runtime errors', () => {
  rejects(createRuntimeSnapshot({ metadata: {} }), 'SNAPSHOT_INVALID_INPUT');
  const snapshot = create();
  rejects(restoreRuntimeSnapshot({ ...snapshot, format: 'other' }, binding), 'SNAPSHOT_UNSUPPORTED_FORMAT');
  rejects(restoreRuntimeSnapshot(snapshot, { ...binding, matchId: 'foreign' }), 'SNAPSHOT_SCOPE_MISMATCH');
  rejects(restoreRuntimeSnapshot(snapshot, { ...binding, seatIds: ['seat-x', 'seat-b'] }), 'SNAPSHOT_SCOPE_MISMATCH');
  rejects(restoreRuntimeSnapshot(snapshot, { ...binding, ruleVersion: 'other' }), 'SNAPSHOT_VERSION_MISMATCH');
  rejects(restoreRuntimeSnapshot(snapshot, { ...binding, cardVersion: 'other' }), 'SNAPSHOT_VERSION_MISMATCH');
  const corrupt = input(); corrupt.engineState.runtimeContext.rngState.cursor += 1;
  rejects(createRuntimeSnapshot(corrupt), 'SNAPSHOT_INVALID_STATE');
  const rngFormat = structuredClone(snapshot); rngFormat.engineState.runtimeContext.rngState.schemaVersion = 2;
  rejects(restore(rngFormat), 'SNAPSHOT_UNSUPPORTED_FORMAT');
});

test('S02-SNAPSHOT-29: incomplete active reference mappings return reference-not-ready', () => {
  const current = cardInput();
  current.referenceState.entries.pop();
  rejects(createRuntimeSnapshot(current), 'SNAPSHOT_REFERENCE_NOT_READY');
  const extra = cardInput();
  extra.referenceState.issuedRefs.push('r:ffffffffffffffffffffffffffffffff');
  extra.referenceState.entries.push({ viewerSeat: 'seat-a', identity: { matchId: config.matchId, instanceId: 'i:999999' }, cardRef: 'r:ffffffffffffffffffffffffffffffff' });
  rejects(createRuntimeSnapshot(extra), 'SNAPSHOT_REFERENCE_NOT_READY');
  const malformed = input(); malformed.referenceState.issuedRefs = 'not-an-array';
  rejects(createRuntimeSnapshot(malformed), 'SNAPSHOT_INVALID_STATE');
});

test('S02-SNAPSHOT-30: duplicate physical identity and alias drift return invalid state', () => {
  const duplicate = cardInput();
  duplicate.engineState.players.ai.hand.push(duplicate.engineState.players.player.hand[0]);
  rejects(createRuntimeSnapshot(duplicate), 'SNAPSHOT_INVALID_STATE');
  const alias = cardInput();
  alias.engineState.players.player.hand[0].uid = 'rt:i:999';
  rejects(createRuntimeSnapshot(alias), 'SNAPSHOT_INVALID_STATE');
});

test('S02-SNAPSHOT-31: rejects legacy state wrappers and projection DTOs as authority state', () => {
  const current = input();
  rejects(createRuntimeSnapshot({ metadata: current.metadata, revision: 0, engineState: { state: current.engineState }, referenceState: current.referenceState }), 'SNAPSHOT_UNSUPPORTED_STATE');
  rejects(createRuntimeSnapshot({ ...current, state: current.engineState }), 'SNAPSHOT_INVALID_INPUT');
  const deck = cardInput();
  rejects(createRuntimeSnapshot({ ...deck, engineState: deck.engineState.players.player }), 'SNAPSHOT_UNSUPPORTED_STATE');
  const viewInput = cardInput();
  const view = projectRuntimeView(viewInput.engineState, viewInput.referenceState, {
    matchId: config.matchId, viewerSeat: config.seatIds[0], revision: 0
  });
  assert.equal(view.ok, true);
  rejects(createRuntimeSnapshot({ ...viewInput, engineState: view.value }), 'SNAPSHOT_UNSUPPORTED_STATE');
});

test('S02-SNAPSHOT-32: start options use session recipe and tutorial validation', () => {
  for (const recipe of [[['UNKNOWN-CARD', 1]], [['STD-022', 0]], [['STD-022', Number.MAX_SAFE_INTEGER], ['STD-023', 1]], [Array(1)]]) {
    const current = input(); current.metadata.startOptions.playerDeckRecipe = recipe;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_INVALID_INPUT');
  }
  const tutorial = session({ gameOptions: { mode: 'tutorial' } });
  tutorial.metadata.startOptions.playerDeckRecipe = [];
  rejects(createRuntimeSnapshot({ ...tutorial, referenceState: references(tutorial.engineState) }), 'SNAPSHOT_INVALID_INPUT');
});

test('S02-SNAPSHOT-33: metadata mode errors and unsupported modes have distinct categories', () => {
  for (const mode of [123, 'unknown']) {
    const current = input(); current.metadata.startOptions.mode = mode;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_INVALID_INPUT');
  }
  for (const mode of ['lab', 'sandbox']) {
    const current = input(); current.metadata.startOptions.mode = mode;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_UNSUPPORTED_STATE');
  }
});

test('S02-SNAPSHOT-34: engine mode errors distinguish malformed from unsupported modes', () => {
  for (const mode of [123, 'unknown']) {
    const current = input(); current.engineState.mode = mode;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_INVALID_STATE');
  }
  for (const mode of ['lab', 'sandbox']) {
    const current = input(); current.engineState.mode = mode;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_UNSUPPORTED_STATE');
  }
});

test('S02-SNAPSHOT-35: optional-root type errors differ from valid non-idle values on restore', () => {
  const base = create();
  const badObject = structuredClone(base); badObject.engineState.runtimeDestructionContinuations = 1;
  rejects(restore(badObject), 'SNAPSHOT_INVALID_STATE');
  const badArray = structuredClone(base); badArray.engineState.deferredTrashMoves = 'not-an-array';
  rejects(restore(badArray), 'SNAPSHOT_INVALID_STATE');
  const badBoolean = structuredClone(base); badBoolean.engineState.drainingIndependentEffects = 'false';
  rejects(restore(badBoolean), 'SNAPSHOT_INVALID_STATE');
  const activeObject = structuredClone(base); activeObject.engineState.runtimeDestructionContinuations = { work: true };
  rejects(restore(activeObject), 'SNAPSHOT_UNSUPPORTED_STATE');
  const activeArray = structuredClone(base); activeArray.engineState.deferredTrashMoves = [{ work: true }];
  rejects(restore(activeArray), 'SNAPSHOT_UNSUPPORTED_STATE');
  const activeBoolean = structuredClone(base); activeBoolean.engineState.drainingIndependentEffects = true;
  rejects(restore(activeBoolean), 'SNAPSHOT_UNSUPPORTED_STATE');
  const activeNullGroup = input(); activeNullGroup.engineState.securityRestWindow = 'player';
  assert.equal(createRuntimeSnapshot(activeNullGroup).ok, true, 'Stage04 supports the optional Security input window');
  for (const key of ['std094TurnEndDone', 'std141TurnEndDone', 'std142TurnEndDone', 'resumeTurnEndAfterSelection']) {
    const activePlayerMarker = input();
    activePlayerMarker.engineState.securityRestWindow = 'player';
    activePlayerMarker.engineState[key] = 'player';
    const playerMarkerSnapshot = createRuntimeSnapshot(activePlayerMarker);
    assert.equal(playerMarkerSnapshot.ok, true, `${key} accepts the runtime player marker`);
    assert.equal(restore(playerMarkerSnapshot.value).ok, true, `${key} roundtrips with required input`);
    const invalidPlayerMarker = input();
    invalidPlayerMarker.engineState.securityRestWindow = 'player';
    invalidPlayerMarker.engineState[key] = 'seat-a';
    rejects(createRuntimeSnapshot(invalidPlayerMarker), 'SNAPSHOT_INVALID_STATE');
  }
});

test('S02-SNAPSHOT-36: accepts frozen inputs and propagates reflection exceptions', () => {
  const current = deepFreeze(input());
  assert.equal(createRuntimeSnapshot(current).ok, true);
  const failure = new Error('reflection-failed');
  const proxy = new Proxy(input(), { getPrototypeOf() { throw failure; } });
  assert.throws(() => createRuntimeSnapshot(proxy), error => error === failure);
});

test('S02-SNAPSHOT-37: snapshot envelope distinguishes input shapes from format identifiers', () => {
  const snapshot = create();
  for (const invalid of [null, 1, 'snapshot', Object.create(null), Object.create({ format: snapshot.format })]) {
    rejects(restore(invalid), 'SNAPSHOT_INVALID_INPUT');
  }
  rejects(restore([]), 'SNAPSHOT_UNSUPPORTED_FORMAT');
  rejects(restore(Array(1)), 'SNAPSHOT_INVALID_INPUT');
  const extraArray = []; extraArray.extra = true;
  rejects(restore(extraArray), 'SNAPSHOT_INVALID_INPUT');
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', { enumerable: true, get() { throw new Error('must not run'); } });
  rejects(restore(accessorArray), 'SNAPSHOT_INVALID_INPUT');
  const noFormat = structuredClone(snapshot); delete noFormat.format;
  rejects(restore(noFormat), 'SNAPSHOT_UNSUPPORTED_FORMAT');
  rejects(restore({ ...snapshot, format: 1 }), 'SNAPSHOT_INVALID_INPUT');
  rejects(restore({ ...snapshot, format: 'legacy-format' }), 'SNAPSHOT_UNSUPPORTED_FORMAT');
  const accessor = { ...snapshot };
  Object.defineProperty(accessor, 'metadata', { enumerable: true, get() { throw new Error('must not run'); } });
  rejects(restore(accessor), 'SNAPSHOT_INVALID_INPUT');
  const symbol = { ...snapshot, [Symbol('extra')]: true };
  rejects(restore(symbol), 'SNAPSHOT_INVALID_INPUT');
  const hidden = { ...snapshot };
  Object.defineProperty(hidden, 'extra', { value: true, enumerable: false });
  rejects(restore(hidden), 'SNAPSHOT_INVALID_INPUT');
});

test('S02-SNAPSHOT-38: schema versions classify invalid numbers separately from unsupported integers', () => {
  const snapshot = create();
  for (const schemaVersion of ['1', 1.5, -0, -1, NaN, Infinity]) {
    rejects(restore({ ...snapshot, schemaVersion }), 'SNAPSHOT_INVALID_INPUT');
  }
  for (const schemaVersion of [0, 2, Number.MAX_SAFE_INTEGER]) {
    rejects(restore({ ...snapshot, schemaVersion }), 'SNAPSHOT_UNSUPPORTED_FORMAT');
  }
  assert.equal(restore({ ...snapshot, schemaVersion: 1 }).ok, true);
});

test('S02-SNAPSHOT-39: every authority serial counter and slot revision is validated before JSON copying', () => {
  const fields = ['projectionSerial', 'selectionQueueSerial', 'legacyProjectionOwnerSerial', 'effectSerial', 'tokenSerial', 'triggerSerial', 'declarationSerial'];
  for (const key of fields) {
    const current = input(); current.engineState[key] = -0;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_INVALID_STATE');
    const snapshot = create(); snapshot.engineState[key] = Number.MAX_SAFE_INTEGER + 1;
    rejects(restore(snapshot), 'SNAPSHOT_INVALID_STATE');
  }
  for (const key of ['pending', 'prompt']) {
    const current = input(); current.engineState.projectionSlotRevision[key] = NaN;
    rejects(createRuntimeSnapshot(current), 'SNAPSHOT_INVALID_STATE');
  }
  const restoredSlot = create(); restoredSlot.engineState.projectionSlotRevision.prompt = -0;
  rejects(restore(restoredSlot), 'SNAPSHOT_INVALID_STATE');
  const turn = input(); turn.engineState.turnNumber = 0;
  rejects(createRuntimeSnapshot(turn), 'SNAPSHOT_INVALID_STATE');
  const restoredTurn = create(); restoredTurn.engineState.turnNumber = NaN;
  rejects(restore(restoredTurn), 'SNAPSHOT_INVALID_STATE');
  const nested = input(); nested.engineState.projectionSlotRevision.audit = { preserved: true };
  const snapshot = create(nested);
  assert.deepEqual(restore(snapshot).value.engineState.projectionSlotRevision.audit, { preserved: true });
});

test('S02-SNAPSHOT-40: restore validates runtimeContext before cloning', () => {
  const base = create();
  const nullContext = structuredClone(base); nullContext.engineState.runtimeContext = null;
  rejects(restore(nullContext), 'SNAPSHOT_INVALID_STATE');
  const missingKey = structuredClone(base); delete missingKey.engineState.runtimeContext.rngState;
  rejects(restore(missingKey), 'SNAPSHOT_INVALID_STATE');
  const extraKey = structuredClone(base); extraKey.engineState.runtimeContext.unexpected = true;
  rejects(restore(extraKey), 'SNAPSHOT_INVALID_STATE');
});
