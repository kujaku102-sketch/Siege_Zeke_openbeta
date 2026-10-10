import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeIdentityIndex } from '../src/game/runtime/bridge.js';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { retireInstanceId } from '../src/game/runtime/identity.js';
import {
  activateCardEffect, activateResponse, activateScript, addSandboxCardToHand, cloneForHistory,
  createGame, dealFortressDamage, declinePrompt, declineResponse, destroyCard, findCard,
  getActivatableEffects, installCard, playCard, playLayeredCard, recoverRegistryCard,
  relogCard, resolveAccessDragPlacement, resolveCardSelection, startTurn
} from '../src/game/engine.js';

function game(gameOptions = {}) {
  const result = createRuntimeSession({ matchId: 'bridge-match', seatIds: ['seat-a', 'seat-b'], seed: 0, ruleVersion: 'rules', cardVersion: 'cards', gameOptions });
  assert.equal(result.ok, true);
  return result.value.engineState;
}
const fresh = () => game({ mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-022', 12]], aiDeckRecipe: [['STD-022', 12]] });
const copy = state => cloneForHistory(state);

function snapshot(input, seen = new Map()) {
  if (input === null || typeof input !== 'object') return input;
  if (seen.has(input)) return { shared: seen.get(input) };
  seen.set(input, seen.size);
  return { prototype: Object.getPrototypeOf(input), descriptors: Reflect.ownKeys(input).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return [key, Object.hasOwn(descriptor, 'value') ? { ...descriptor, value: snapshot(descriptor.value, seen) } : descriptor];
  }) };
}

function invoke(state) {
  const before = snapshot(state);
  const result = buildRuntimeIdentityIndex(state);
  assert.deepEqual(snapshot(state), before);
  assert.deepEqual(Object.keys(result), result.ok ? ['ok', 'value'] : ['ok', 'error']);
  if (!result.ok) assert.deepEqual(Object.keys(result.error), ['code']);
  return result;
}

function index(state) {
  const result = invoke(state);
  assert.equal(result.ok, true);
  assert.equal(result.value.matchId, state.runtimeContext.matchId);
  assert.equal(result.value.entries.length, state.runtimeContext.identityState.nextSerial - 1 - state.runtimeContext.identityState.retiredIds.length);
  return result.value;
}
const rejects = (state, code) => assert.deepEqual(invoke(state), { ok: false, error: { code } });
const entry = (state, card) => index(state).entries.find(row => row.identity.instanceId === card.identity.instanceId);

function add(state, id, owner = 'player') {
  assert.equal(addSandboxCardToHand(state, owner, id), true);
  return state.players[owner].hand.at(-1);
}
function execute(state, card, options = {}) {
  assert.equal(playCard(state, card.owner, card.uid, { free: true, force: true, ignoreColor: true, ...options }), true);
  return card;
}
function answer(state, result) {
  assert.ok(state.pending?.request);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [], ...result }), true);
}
function symbol(state, id, owner = 'player') {
  const card = add(state, id, owner);
  assert.equal(installCard(state, owner, card.uid, { force: true }), true);
}
function freeze(input, seen = new Set()) {
  if (input && typeof input === 'object' && !seen.has(input)) {
    seen.add(input);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if (Object.hasOwn(descriptor, 'value')) freeze(descriptor.value, seen);
    Object.freeze(input);
  }
  return input;
}

function decodeFixture() {
  const state = fresh();
  const first = execute(state, add(state, 'STD-020'));
  const second = execute(state, add(state, 'STD-020'));
  assert.equal(destroyCard(state, 'player', first.uid, { suppressReplacement: true }), true);
  assert.equal(destroyCard(state, 'player', second.uid, { suppressReplacement: true }), true);
  const source = execute(state, add(state, 'STD-041'));
  assert.equal(destroyCard(state, 'player', source.uid, { suppressReplacement: true }), true);
  assert.equal(state.pending.request.continuation.type, 'runtime-decode');
  answer(state, { selected: [first.uid, second.uid] });
  assert.equal(state.pending.type, 'decode-place');
  return { state, first, second, source };
}

function responseFixture() {
  const state = fresh();
  state.interactive = true;
  symbol(state, 'STD-143');
  const blocker = execute(state, add(state, 'STD-003', 'ai'), { zone: 'back' });
  execute(state, add(state, 'STD-020', 'ai'));
  const response = add(state, 'STD-143');
  add(state, 'STD-034');
  startTurn(state, 'ai');
  dealFortressDamage(state, 'player', 1, 'ai', 'bridge response');
  assert.equal(state.pending.type, 'response-window');
  assert.equal(activateResponse(state, 'player', response.uid), true);
  assert.equal(state.declaredEffects[0].kind, 'response');
  assert.equal(state.pending.type, 'response-window');
  return { state, blocker, response };
}

test('S02-BRIDGE-01: all runtime startup modes have stored slots and complete indexes', () => {
  for (const options of [{}, { mode: 'tutorial' }, { mode: 'tutorial', tutorialId: 'vengeance' }, { mode: 'lab' }, { mode: 'sandbox' }, { mode: 'sandbox', sandboxDeckSetup: true }]) {
    const state = game(options);
    const built = index(state);
    assert.deepEqual(Object.keys(built), ['matchId', 'entries']);
    assert.deepEqual(invoke(state).value, built);
    for (const [playerId, player] of Object.entries(state.players)) {
      for (const zone of ['front', 'back']) for (const card of player[zone]) {
        assert.deepEqual(entry(state, card).location, { kind: 'board', seatId: playerId === 'player' ? 'seat-a' : 'seat-b', zone, position: card.boardSlot });
        assert.equal(card.boardSlotController, playerId);
        assert.equal(card.boardSlotZone, zone);
      }
    }
  }
  rejects(createGame({ mode: 'sandbox', rng: () => 0.5 }), 'RUNTIME_INVALID_BRIDGE_INPUT');
});

test('S02-BRIDGE-02: install, recover, play, relog and board holes preserve identities', () => {
  const state = fresh();
  const card = add(state, 'STD-020');
  assert.equal(installCard(state, 'player', card.uid), true);
  assert.deepEqual(entry(state, card).location, { kind: 'zone', seatId: 'seat-a', zone: 'registry' });
  startTurn(state, 'player');
  assert.equal(recoverRegistryCard(state, 'player', card.uid), true);
  assert.equal(entry(state, card).location.zone, 'hand');
  execute(state, card, { requestedSlot: 2 });
  assert.equal(entry(state, card).location.position, 2);
  const nextSerial = state.runtimeContext.identityState.nextSerial;
  assert.equal(relogCard(state, 'player', card.uid, 'back', { requestedSlot: 2 }), true);
  assert.deepEqual(entry(state, card).location, { kind: 'board', seatId: 'seat-a', zone: 'back', position: 2 });
  assert.equal(state.runtimeContext.identityState.nextSerial, nextSerial);
  assert.equal(destroyCard(state, 'player', card.uid, { suppressReplacement: true }), true);
  assert.equal(entry(state, card).location.zone, 'trash');
});

test('S02-BRIDGE-03: ordinary Code mounting works both ways and remains after Ob moves', () => {
  for (const codeFirst of [false, true]) {
    const state = fresh();
    const host = add(state, 'STD-020');
    const code = add(state, 'STD-078');
    if (codeFirst) { execute(state, code); execute(state, host, { baseUid: code.uid }); }
    else { execute(state, host); execute(state, code, { underUid: host.uid }); }
    assert.deepEqual(entry(state, code).location, { kind: 'mounted', host: { ...host.identity }, order: 1, role: 'mount' });
    assert.equal(entry(state, code).controllerSeat, 'seat-a');
    assert.equal(relogCard(state, 'player', host.uid, 'back'), true);
    assert.equal(entry(state, code).location.kind, 'board');
    assert.equal(entry(state, code).location.zone, 'front');
  }
});

test('S02-BRIDGE-04: real takeover gives nested layers the host controller and keeps owners', () => {
  const state = fresh();
  symbol(state, 'STD-191');
  const script = execute(state, add(state, 'STD-204'), { zone: 'back' });
  const code = execute(state, add(state, 'STD-078', 'ai'));
  const host = add(state, 'STD-020', 'ai');
  execute(state, host, { baseUid: code.uid });
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(activateScript(state, 'player', script.uid), true);
  const giant = state.players.player.front.find(card => card.id === 'STD-205');
  assert.ok(giant);
  assert.deepEqual(entry(state, host).location, { kind: 'mounted', host: { ...giant.identity }, order: 1, role: 'layered' });
  assert.deepEqual(entry(state, code).location, { kind: 'mounted', host: { ...host.identity }, order: 1, role: 'mount' });
  assert.equal(entry(state, host).ownerSeat, 'seat-b');
  assert.equal(entry(state, code).ownerSeat, 'seat-b');
  assert.equal(entry(state, host).controllerSeat, 'seat-a');
  assert.equal(entry(state, code).controllerSeat, 'seat-a');
});

test('S02-BRIDGE-05: layered sibling order, cost consumption and source movement', () => {
  const state = game({ mode: 'tutorial', tutorialId: 'vengeance' });
  const player = state.players.player;
  const provider = player.hand.find(card => card.id === 'STD-191');
  assert.equal(installCard(state, 'player', provider.uid), true);
  const source = player.hand.find(card => card.id === 'STD-195');
  const materials = [...player.front];
  assert.equal(playLayeredCard(state, 'player', source.uid, materials.map(card => card.uid)), true);
  for (let i = 0; i < materials.length; i += 1) assert.deepEqual(entry(state, materials[i]).location, { kind: 'mounted', host: { ...source.identity }, order: i + 1, role: 'layered' });
  assert.equal(relogCard(state, 'player', source.uid, 'back', { useLayerDiscount: true, layerUid: materials[0].uid }), true);
  assert.equal(entry(state, materials[0]).location.zone, 'trash');
  assert.equal(entry(state, materials[1]).location.order, 1);
  assert.equal(entry(state, source).location.zone, 'back');
});

test('S02-BRIDGE-06: foreign-board ownership and virtual token cards remain live', () => {
  const state = fresh();
  const proof = execute(state, add(state, 'STD-228'));
  const effect = getActivatableEffects(state, 'player', proof).find(item => item.kind === 'update');
  assert.equal(activateCardEffect(state, 'player', proof.uid, effect.id), true);
  assert.equal(entry(state, proof).ownerSeat, 'seat-a');
  assert.equal(entry(state, proof).controllerSeat, 'seat-b');
  const generator = execute(state, add(state, 'STD-093'));
  const token = [...state.players.player.front, ...state.players.player.back].find(card => card.token);
  assert.ok(token);
  assert.equal(token.virtual, true);
  assert.equal(destroyCard(state, 'player', token.uid, { suppressReplacement: true }), true);
  assert.equal(entry(state, token).location.zone, 'trash');
  assert.equal(entry(state, generator).location.kind, 'board');
  assert.deepEqual(state.runtimeContext.identityState.retiredIds, []);
});

test('S02-BRIDGE-07: real decode selection owns an exact queue and consumes it into board slots', () => {
  const { state, first, second } = decodeFixture();
  assert.deepEqual(entry(state, first).location, { kind: 'inflight', storageKey: 'pending.decode-place.cards/0' });
  assert.deepEqual(entry(state, second).location, { kind: 'inflight', storageKey: 'pending.decode-place.cards/1' });
  assert.equal(resolveAccessDragPlacement(state, 'player', 'front'), true);
  assert.equal(entry(state, first).location.kind, 'board');
  assert.deepEqual(entry(state, second).location, { kind: 'inflight', storageKey: 'pending.decode-place.cards/0' });
  assert.equal(resolveAccessDragPlacement(state, 'player', 'back'), true);
  assert.equal(entry(state, second).location.zone, 'back');
  assert.equal(state.pending, null);
});

test('S02-BRIDGE-08: Sp choice holds its source until cleanup to trash or BAN', () => {
  for (const destination of ['trash', 'ban']) {
    const state = fresh();
    execute(state, add(state, 'STD-020'));
    const target = execute(state, add(state, 'STD-022', 'ai'));
    if (destination === 'ban') {
      const script = execute(state, add(state, 'STD-003', 'ai'), { zone: 'back' });
      startTurn(state, 'ai');
      assert.equal(activateScript(state, 'ai', script.uid), true);
    }
    const spell = execute(state, add(state, 'STD-086'), { targetUid: target.uid });
    assert.equal(state.pending.request.continuation.type, 'runtime-action-selection');
    assert.deepEqual(entry(state, spell).location, { kind: 'inflight', storageKey: 'deferredSpellCleanup/card' });
    answer(state, { selected: [] });
    assert.equal(entry(state, spell).location.zone, destination);
  }
});

test('S02-BRIDGE-09: declared Response and started cleanup transfer physical ownership once', () => {
  const { state, blocker, response } = responseFixture();
  assert.deepEqual(entry(state, response).location, { kind: 'inflight', storageKey: 'declaredEffects/0/card' });
  assert.equal(declineResponse(state, 'player'), true);
  assert.equal(state.prompt.scriptUid, blocker.uid);
  assert.equal(state.deferredDeclaredResponseCleanup.cleanupStarted, true);
  assert.deepEqual(entry(state, response).location, { kind: 'inflight', storageKey: 'deferredTrashMoves/0/card' });
  assert.equal(index(state).entries.filter(row => row.identity.instanceId === response.identity.instanceId).length, 1);
  assert.equal(declinePrompt(state), true);
  assert.equal(entry(state, response).location.zone, 'trash');
});

test('S02-BRIDGE-10: resolving Response before cleanup holds its card while destruction waits', () => {
  const state = fresh();
  state.interactive = true;
  const blocker = execute(state, add(state, 'STD-003'), { zone: 'back' });
  const target = execute(state, add(state, 'STD-020', 'ai'));
  const response = add(state, 'STD-034');
  dealFortressDamage(state, 'player', 1, 'ai', 'bridge response');
  assert.equal(activateResponse(state, 'player', response.uid, target.uid), true);
  assert.equal(state.prompt.scriptUid, blocker.uid);
  assert.equal(state.deferredDeclaredResponseCleanup.cleanupStarted, false);
  assert.deepEqual(entry(state, response).location, { kind: 'inflight', storageKey: 'resolvingDeclaredEffect/card' });
  assert.equal(entry(state, target).location.kind, 'board');
  assert.equal(activateScript(state, 'player', blocker.uid), true);
  assert.equal(entry(state, response).location.zone, 'trash');
  assert.equal(entry(state, target).location.zone, 'trash');
});

test('S02-BRIDGE-11: paused script LKI does not duplicate the live source', () => {
  const state = fresh();
  const blocker = execute(state, add(state, 'STD-003', 'ai'), { zone: 'back' });
  const source = execute(state, add(state, 'STD-036'), { zone: 'back' });
  assert.equal(activateScript(state, 'player', source.uid), true);
  assert.equal(state.prompt.scriptUid, blocker.uid);
  assert.equal(state.resolvingDeclaredEffect.kind, 'script');
  assert.deepEqual(entry(state, source).location, { kind: 'inflight', storageKey: 'deferredTrashMoves/0/card' });
  assert.equal(index(state).entries.filter(row => row.identity.instanceId === source.identity.instanceId).length, 1);
  assert.equal(declinePrompt(state), true);
  assert.equal(entry(state, source).location.zone, 'trash');
});

test('S02-BRIDGE-12: snapshots, logs, trigger sources, continuations and history are references', () => {
  const state = fresh();
  const card = state.players.player.hand[0];
  const expected = index(state);
  state.history.push({ card, rng: state.rng });
  state.events.push({ card });
  state.log.push({ card });
  state.triggerQueue.push({ source: { card } });
  state.deferredAttack = { sourceUid: card.uid };
  assert.deepEqual(index(state), expected);
});

test('S02-BRIDGE-13: duplicate physical storage, missing storage and retired ledger fixtures', () => {
  const state = fresh();
  const duplicate = copy(state);
  duplicate.players.player.trash.push(duplicate.players.player.hand[0]);
  rejects(duplicate, 'DUPLICATE_INSTANCE');
  const missing = copy(state); missing.players.player.hand.pop();
  rejects(missing, 'INVALID_LOCATION');
  const retired = copy(state);
  const card = retired.players.player.hand[0];
  const ledger = retireInstanceId(retired.runtimeContext.identityState, card.identity);
  assert.equal(ledger.ok, true);
  retired.runtimeContext.identityState = ledger.value;
  rejects(retired, 'RETIRED_INSTANCE');
  retired.players.player.hand.shift(); // Unit ledger fixture, not an engine retirement action.
  assert.equal(index(retired).entries.some(row => row.identity.instanceId === card.identity.instanceId), false);
  assert.equal(retired.runtimeContext.uidAliases.length, retired.runtimeContext.identityState.nextSerial - 1);
});

test('S02-BRIDGE-14: alias completeness, uniqueness and physical-card agreement', () => {
  const state = fresh();
  for (const change of [
    candidate => candidate.runtimeContext.uidAliases.pop(),
    candidate => { candidate.runtimeContext.uidAliases[1] = candidate.runtimeContext.uidAliases[0]; },
    candidate => { candidate.runtimeContext.uidAliases[0].uid = 'wrong'; },
    candidate => { candidate.runtimeContext.uidAliases[0].definitionId = 'missing'; },
    candidate => { candidate.runtimeContext.uidAliases[0].ownerSeat = 'outside'; },
    candidate => { candidate.players.player.hand[0].id = 'STD-020'; },
    candidate => { candidate.players.player.hand[0].ownerSeat = 'seat-b'; }
  ]) {
    const candidate = copy(state); change(candidate); rejects(candidate, 'RUNTIME_ALIAS_MISMATCH');
  }
  const badLedger = copy(state); badLedger.runtimeContext.identityState.nextSerial = 0;
  rejects(badLedger, 'INVALID_IDENTITY_STATE');
  const match = copy(state); match.runtimeContext.identityState.matchId = 'other-match'; match.runtimeContext.identityState.seatIds.reverse();
  rejects(match, 'MATCH_MISMATCH');
  const seat = copy(state); seat.runtimeContext.identityState.seatIds.reverse();
  rejects(seat, 'SEAT_MISMATCH');
});

test('S02-BRIDGE-15: strict board bindings preserve holes and reject forged locations', () => {
  const state = fresh();
  const first = execute(state, add(state, 'STD-020'), { requestedSlot: 2 });
  const second = execute(state, add(state, 'STD-021'), { requestedSlot: 3 });
  assert.equal(entry(state, first).location.position, 2);
  for (const change of [
    card => { delete card.boardSlot; }, card => { card.boardSlot = '2'; },
    card => { card.boardSlot = 0; }, card => { card.boardSlot = -0; },
    card => { card.boardSlot = 1.5; }, card => { card.boardSlot = 99; },
    card => { card.boardSlotController = 'ai'; }, card => { card.boardSlotZone = 'back'; }
  ]) {
    const candidate = copy(state); change(candidate.players.player.front[0]); rejects(candidate, 'RUNTIME_INVALID_BRIDGE_INPUT');
  }
  const duplicate = copy(state); duplicate.players.player.front[1].boardSlot = 2;
  rejects(duplicate, 'DUPLICATE_LOCATION');
  assert.equal(entry(state, second).location.position, 3);
});

test('S02-BRIDGE-16: mounted role defaults, cycles and repeated individuals', () => {
  const state = fresh();
  const host = execute(state, add(state, 'STD-020'));
  const child = execute(state, add(state, 'STD-078'), { underUid: host.uid });
  for (const role of [null, 'layered']) {
    const candidate = copy(state); candidate.players.player.front[0].mounted[0].layerRole = role;
    assert.equal(entry(candidate, child).location.role, 'layered');
  }
  const omitted = copy(state); delete omitted.players.player.front[0].mounted[0].layerRole;
  assert.equal(entry(omitted, child).location.role, 'layered');
  const invalid = copy(state); invalid.players.player.front[0].mounted[0].layerRole = 'unknown';
  rejects(invalid, 'RUNTIME_INVALID_BRIDGE_INPUT');
  const cycle = copy(state); const copiedHost = cycle.players.player.front[0]; copiedHost.mounted[0].mounted.push(copiedHost);
  rejects(cycle, 'MOUNT_CYCLE');
  const duplicate = copy(state); duplicate.players.player.front[0].mounted.push(duplicate.players.player.front[0].mounted[0]);
  rejects(duplicate, 'DUPLICATE_INSTANCE');
});

test('S02-BRIDGE-17: decode phase rejects queue/card/source mismatch without repairs', () => {
  const { state } = decodeFixture();
  for (const change of [
    candidate => candidate.pending.queue.reverse(),
    candidate => { candidate.pending.sourceUid = candidate.pending.queue[1]; },
    candidate => candidate.pending.cards.pop(),
    candidate => { candidate.pending.queue[1] = candidate.pending.queue[0]; }
  ]) {
    const candidate = copy(state); change(candidate); rejects(candidate, 'RUNTIME_PHASE_MISMATCH');
  }
});

test('S02-BRIDGE-18: Response cleanup metadata and transferred storage must agree', () => {
  const { state } = responseFixture();
  assert.equal(declineResponse(state, 'player'), true);
  index(state);
  for (const change of [
    candidate => { candidate.deferredDeclaredResponseCleanup.cleanupStarted = false; candidate.deferredDeclaredResponseCleanup.cleanupDone = true; },
    candidate => { candidate.deferredDeclaredResponseCleanup.declaredEffectId = 'wrong'; },
    candidate => { candidate.deferredDeclaredResponseCleanup.playerId = 'ai'; },
    candidate => { candidate.deferredDeclaredResponseCleanup.cleanupStarted = 'true'; },
    candidate => { candidate.players.player.hand.push(candidate.deferredTrashMoves.shift().card); },
    candidate => { candidate.deferredTrashMoves = []; }
  ]) {
    const candidate = copy(state); change(candidate); rejects(candidate, 'RUNTIME_PHASE_MISMATCH');
  }
  const unknown = copy(state); unknown.resolvingDeclaredEffect.kind = 'unknown'; unknown.deferredDeclaredResponseCleanup = null;
  rejects(unknown, 'RUNTIME_UNSUPPORTED_STORAGE');
});

test('S02-BRIDGE-19: unsupported virtual storage fails closed', () => {
  const state = fresh();
  const card = state.players.player.hand.pop();
  state.players.player.virtual.push(card);
  rejects(state, 'RUNTIME_UNSUPPORTED_STORAGE');
});

test('S02-BRIDGE-20: pure repeated calls, frozen inputs and independent returned indexes', () => {
  const state = fresh();
  const host = execute(state, add(state, 'STD-020'));
  const layer = execute(state, add(state, 'STD-078'), { underUid: host.uid });
  const first = index(state);
  const second = index(freeze(copy(state)));
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.entries[0].identity.instanceId = 'i:999';
  first.entries[0].location.zone = 'ban';
  const mounted = first.entries.find(row => row.identity.instanceId === layer.identity.instanceId);
  mounted.location.host.instanceId = 'i:999';
  assert.deepEqual(index(state), second);
});

test('S02-BRIDGE-21: required getters never execute and reflection failures propagate', () => {
  let called = 0;
  const state = fresh();
  for (const [object, key, expected] of [
    [copy(state), 'runtimeContext', 'RUNTIME_INVALID_BRIDGE_INPUT'],
    [copy(state).players.player, 'hand', 'RUNTIME_INVALID_BRIDGE_INPUT']
  ]) {
    if (key === 'runtimeContext') {
      Object.defineProperty(object, key, { enumerable: true, get() { called += 1; throw new Error('getter'); } });
      rejects(object, expected);
    } else {
      const candidate = copy(state); candidate.players.player = object;
      Object.defineProperty(object, key, { enumerable: true, get() { called += 1; throw new Error('getter'); } });
      rejects(candidate, expected);
    }
  }
  const cardGetter = copy(state);
  Object.defineProperty(cardGetter.players.player.hand[0], 'identity', { enumerable: true, get() { called += 1; throw new Error('getter'); } });
  rejects(cardGetter, 'RUNTIME_INVALID_BRIDGE_INPUT');
  const arrayGetter = copy(state);
  Object.defineProperty(arrayGetter.players.player.hand, '0', { enumerable: true, get() { called += 1; throw new Error('getter'); } });
  rejects(arrayGetter, 'RUNTIME_INVALID_BRIDGE_INPUT');
  assert.equal(called, 0);
  const reflection = new Error('reflection');
  for (const trap of ['getPrototypeOf', 'getOwnPropertyDescriptor']) assert.throws(() => buildRuntimeIdentityIndex(new Proxy(state, { [trap]() { throw reflection; } })), error => error === reflection);
  const contextProxy = { ...state, runtimeContext: new Proxy(state.runtimeContext, { ownKeys() { throw reflection; } }) };
  assert.throws(() => buildRuntimeIdentityIndex(contextProxy), error => error === reflection);
});

test('S02-BRIDGE-22: ordinary descriptors and dense arrays are required', () => {
  const state = fresh();
  rejects(Object.assign(Object.create(null), state), 'RUNTIME_INVALID_BRIDGE_INPUT');
  for (const change of [
    candidate => { candidate.players.player.hand = [, ...candidate.players.player.hand]; },
    candidate => { candidate.players.player.hand.extra = 1; },
    candidate => { candidate.players.player.hand[Symbol('extra')] = 1; },
    candidate => { Object.defineProperty(candidate.players.player, 'front', { enumerable: false }); },
    candidate => { candidate.runtimeContext.extra = 1; }
  ]) {
    const candidate = copy(state); change(candidate); rejects(candidate, 'RUNTIME_INVALID_BRIDGE_INPUT');
  }
  const malformedAlias = copy(state); malformedAlias.runtimeContext.uidAliases[0].extra = 1;
  rejects(malformedAlias, 'RUNTIME_ALIAS_MISMATCH');
});
