import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LIBRARY, LAB_CARD_IDS, USER_CARDS, createCardInstance, createToken, expandDeck } from '../src/data/cards.js';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { RuntimeError, createRuntimeCard, createRuntimeToken, expandRuntimeDeck } from '../src/game/runtime/factory.js';
import { nextRng } from '../src/game/runtime/rng.js';
import {
  activateCardEffect, activateScript, addSandboxCardToHand, attack, cloneForHistory, createGame,
  declinePrompt, destroyCard, endTurn, findCard, getActivatableEffects, installCard, playCard, playLayeredCard,
  relogCard, remember, resolveCardSelection, startTurn, undo
} from '../src/game/engine.js';

const config = (gameOptions = {}, seed = 0) => ({ matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], seed, ruleVersion: 'rule-label', cardVersion: 'card-label', gameOptions });
const resultValue = input => {
  const result = createRuntimeSession(input);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result), ['ok', 'value']);
  return result.value;
};
const game = (gameOptions = {}, seed = 0) => resultValue(config(gameOptions, seed)).engineState;
const fresh = () => game({ mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-022', 12]], aiDeckRecipe: [['STD-022', 12]] });
const rejects = (input, code = 'RUNTIME_INVALID_CONFIG') => assert.deepEqual(createRuntimeSession(input), { ok: false, error: { code } });
const throwsCode = (callback, code) => assert.throws(callback, error => error instanceof RuntimeError && error.code === code);

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (Object.hasOwn(descriptor, 'value')) freeze(descriptor.value);
    Object.freeze(value);
  }
  return value;
}

function liveCards(state) {
  const cards = [];
  const mounted = card => {
    cards.push(card);
    for (const layer of card.mounted ?? []) mounted(layer);
  };
  for (const player of Object.values(state.players)) {
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban', 'virtual']) for (const card of player[zone]) mounted(card);
  }
  return cards;
}

function audit(state) {
  const context = state.runtimeContext;
  const cards = liveCards(state);
  assert.deepEqual(Object.keys(context), ['matchId', 'seatIds', 'identityState', 'rngState', 'uidAliases']);
  assert.equal(cards.length, context.identityState.nextSerial - 1);
  assert.equal(context.uidAliases.length, cards.length);
  assert.deepEqual(context.identityState.retiredIds, []);
  assert.equal(new Set(cards.map(card => card.uid)).size, cards.length);
  assert.equal(new Set(cards.map(card => card.identity.instanceId)).size, cards.length);
  for (const card of cards) {
    const alias = context.uidAliases.find(entry => entry.uid === card.uid);
    assert.ok(alias);
    assert.deepEqual(Object.keys(alias), ['uid', 'identity', 'ownerSeat', 'definitionId']);
    assert.deepEqual(card.identity, alias.identity);
    assert.notEqual(card.identity, alias.identity);
    assert.deepEqual(Object.keys(card.identity), ['matchId', 'instanceId']);
    assert.equal(card.identity.matchId, context.matchId);
    assert.equal(card.uid, `rt:${card.identity.instanceId}`);
    assert.equal(alias.definitionId, card.id);
    assert.equal(card.ownerSeat, context.seatIds[card.owner === 'player' ? 0 : 1]);
    assert.equal(alias.ownerSeat, card.ownerSeat);
    assert.equal(Object.hasOwn(card, 'controllerSeat'), false);
  }
  return cards;
}

function add(state, id, owner = 'player') {
  assert.equal(addSandboxCardToHand(state, owner, id), true);
  return state.players[owner].hand.at(-1);
}

function execute(state, card, options = {}) {
  assert.equal(playCard(state, card.owner, card.uid, { free: true, force: true, ignoreColor: true, ...options }), true);
  return card;
}

function ability(state, card, kind, options = {}) {
  const effect = getActivatableEffects(state, card.owner, card).find(item => item.kind === kind);
  assert.ok(effect, `${card.id} ${kind}`);
  assert.equal(activateCardEffect(state, card.owner, card.uid, effect.id, options), true);
}

function answer(state, result) {
  assert.ok(state.pending?.request);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [], ...result }), true);
}

test('S02-SESSION-01: exact session shape and all startup families', () => {
  for (const options of [{}, { mode: 'tutorial' }, { mode: 'tutorial', tutorialId: 'vengeance' }, { mode: 'lab' }, { mode: 'sandbox', sandboxDeckSetup: false }, { mode: 'sandbox', sandboxDeckSetup: true }]) {
    const session = resultValue(config(options));
    assert.deepEqual(Object.keys(session), ['metadata', 'revision', 'engineState']);
    assert.deepEqual(Object.keys(session.metadata), ['matchId', 'seatIds', 'ruleVersion', 'cardVersion', 'startOptions']);
    assert.equal(session.revision, 0);
    assert.equal(session.metadata.ruleVersion, 'rule-label');
    assert.equal(session.metadata.cardVersion, 'card-label');
    assert.notEqual(session.metadata.seatIds, session.engineState.runtimeContext.seatIds);
    const cards = audit(session.engineState);
    if (options.mode === 'lab') {
      assert.equal(cards.length, LAB_CARD_IDS.length + 7);
      assert.equal(session.engineState.runtimeContext.rngState.draws, 0);
    }
    if (options.mode === 'sandbox' && !options.sandboxDeckSetup) {
      assert.equal(cards.length, 27);
      assert.equal(session.engineState.runtimeContext.rngState.draws, 0);
    }
    if (options.mode === 'tutorial') assert.equal(session.engineState.runtimeContext.rngState.draws, 0);
  }
});

test('S02-SESSION-02: deterministic decks and RNG with independent metadata', () => {
  const input = config({ mode: 'ai', playerDeckRecipe: [['STD-022', 2], ['STD-023', 3], ['STD-022', 1]], aiDeckRecipe: [['STD-024', 6]] }, 4294967295);
  const before = structuredClone(input);
  const a = resultValue(freeze(input));
  const b = resultValue(before);
  assert.deepEqual(a.engineState.players, b.engineState.players);
  assert.deepEqual(a.engineState.runtimeContext, b.engineState.runtimeContext);
  assert.equal(a.engineState.runtimeContext.rngState.draws, 10);
  assert.deepEqual(a.metadata.startOptions.playerDeckRecipe, before.gameOptions.playerDeckRecipe);
  assert.notEqual(a.metadata.startOptions.playerDeckRecipe, input.gameOptions.playerDeckRecipe);
  assert.notEqual(a.metadata.startOptions.playerDeckRecipe[0], input.gameOptions.playerDeckRecipe[0]);
  a.metadata.startOptions.playerDeckRecipe[0][1] = 99;
  a.metadata.seatIds[0] = 'changed';
  assert.equal(a.engineState.runtimeContext.seatIds[0], 'seat-a');
  assert.deepEqual(input.gameOptions.playerDeckRecipe, before.gameOptions.playerDeckRecipe);
  audit(a.engineState);
  audit(b.engineState);
});

test('S02-SESSION-03: strict configuration shape without getter execution', () => {
  for (const input of [null, undefined, [], 1, 'x', () => {}, Object.assign(Object.create(null), config()), Object.assign(Object.create({}), config())]) rejects(input);
  let called = 0;
  for (const name of Object.keys(config())) {
    const missing = config(); delete missing[name]; rejects(missing);
    rejects({ ...config(), [Symbol(name)]: 1 });
    rejects(Object.defineProperty(config(), name, { enumerable: false }));
    rejects(Object.defineProperty(config(), name, { enumerable: true, get() { called += 1; throw new Error('getter'); } }));
  }
  rejects({ ...config(), extra: 0 });
  rejects(Object.defineProperty(config(), 'extra', { value: 0 }));
  for (const gameOptions of [null, [], Object.create(null), { rng: () => 0 }, { runtimeContext: {} }, { mode: undefined }, { [Symbol('mode')]: 'lab' }]) rejects(config(gameOptions));
  rejects(config(Object.defineProperty({}, 'mode', { enumerable: true, get() { called += 1; return 'lab'; } })));
  assert.equal(called, 0);
  const reflection = new Error('reflection');
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    assert.throws(() => createRuntimeSession(new Proxy(config(), { [trap]() { throw reflection; } })), error => error === reflection);
  }
});

test('S02-SESSION-04: malformed config values and seed error distinction', () => {
  for (const field of ['matchId', 'ruleVersion', 'cardVersion']) for (const value of ['', null, 0, {}, undefined]) rejects({ ...config(), [field]: value });
  for (const seatIds of [[], ['a'], ['a', 'a'], ['a', 'b', 'c'], ['a', ''], ['a', 2], ['a', ,], Object.assign(['a', 'b'], { extra: 1 }), Object.assign(['a', 'b'], { [Symbol('extra')]: 1 })]) rejects({ ...config(), seatIds });
  let called = 0;
  const seats = ['a', 'b']; Object.defineProperty(seats, '0', { get() { called += 1; return 'a'; } });
  rejects({ ...config(), seatIds: seats });
  assert.equal(called, 0);
  for (const options of [{ mode: 'cpu' }, { mode: 0 }, { tutorialId: 'unknown' }, { playerDeckId: '__proto__' }, { aiDeckId: 'toString' }, { playerUserId: 'constructor' }, { aiUserId: 0 }, { sandboxDeckSetup: 1 }]) rejects(config(options));
  for (const seed of [-0, -1, 0.5, NaN, Infinity, 4294967296, '0', true, null, undefined, 0n, {}]) rejects({ ...config(), seed }, 'RNG_INVALID_INPUT');
});

test('S02-SESSION-05: exact recipe rows, safe totals and tutorial preflight', () => {
  const malformed = [undefined, {}, [,], [['STD-022']], [['STD-022', 1, 2]], [['missing', 1]], [['toString', 1]], [[1, 1]], [['STD-022', 0]], [['STD-022', -0]], [['STD-022', -1]], [['STD-022', 1.5]], [['STD-022', '1']], [['STD-022', Number.MAX_SAFE_INTEGER], ['STD-023', 1]], Object.assign([['STD-022', 1]], { extra: 1 })];
  for (const playerDeckRecipe of malformed) rejects(config({ playerDeckRecipe }));
  let called = 0;
  const row = ['STD-022', 1]; Object.defineProperty(row, '0', { get() { called += 1; return 'STD-022'; } });
  rejects(config({ playerDeckRecipe: [row] }));
  assert.equal(called, 0);
  rejects(config({ mode: 'tutorial', playerDeckRecipe: [['STD-022', 1]] }));
  rejects(config({ mode: 'tutorial', aiDeckRecipe: [['STD-125', 1], ['STD-131', 1], ['STD-149', 1]] }));
  rejects(config({ mode: 'tutorial', tutorialId: 'vengeance', aiDeckRecipe: [] }));
  const custom = config({ mode: 'tutorial', tutorialId: 'vengeance', playerDeckRecipe: [], aiDeckRecipe: [['STD-125', 1], ['STD-131', 1], ['STD-149', 1]] });
  const before = structuredClone(custom);
  assert.equal(audit(resultValue(freeze(custom)).engineState).length, 10);
  assert.deepEqual(custom, before);
  assert.equal(audit(game({ mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [], aiDeckRecipe: [] })).length, 0);
});

test('S02-SESSION-06: factory registration and legacy constructor delegates', () => {
  const state = game({ mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [], aiDeckRecipe: [] });
  const context = state.runtimeContext;
  const deck = expandRuntimeDeck(context, freeze([['STD-022', 2], ['STD-023', 1]]), 'player');
  const aiCard = createRuntimeCard(context, 'STD-020', 'ai', 91);
  const token = createRuntimeToken(context, 'ai', 92);
  state.players.player.deck.push(...deck);
  state.players.ai.hand.push(aiCard, token);
  assert.deepEqual(audit(state).map(card => card.identity.instanceId), ['i:1', 'i:2', 'i:3', 'i:4', 'i:5']);
  assert.equal(token.token, true);
  assert.equal(token.virtual, true);
  assert.deepEqual(expandRuntimeDeck(null, [['STD-022', 2]], 'player'), expandDeck([['STD-022', 2]], 'player'));
  assert.deepEqual(createRuntimeCard(null, 'STD-020', 'ai', 91), createCardInstance('STD-020', 'ai', 91));
  assert.deepEqual(createRuntimeToken(null, 'ai', 92), createToken('ai', 92));
  const before = structuredClone(context);
  for (const action of [() => createRuntimeCard(context, 'missing', 'player', 1), () => createRuntimeCard(context, 'STD-020', 'outside', 1), () => createRuntimeToken(context, 'outside', 1), () => expandRuntimeDeck(context, [['STD-020', 0]], 'player'), () => createRuntimeCard({ ...context, extra: 0 }, 'STD-020', 'player', 1)]) throwsCode(action, 'RUNTIME_INVALID_FACTORY_INPUT');
  assert.deepEqual(context, before);
  const reflection = new Error('factory reflection');
  assert.throws(() => createRuntimeCard(new Proxy(context, { ownKeys() { throw reflection; } }), 'STD-020', 'player', 1), error => error === reflection);
});

test('S02-SESSION-07: both-seat sandbox addition and Punks generation', () => {
  for (const owner of ['player', 'ai']) {
    const state = fresh();
    if (owner === 'ai') startTurn(state, owner);
    const source = add(state, 'STD-093', owner);
    const before = state.runtimeContext.identityState.nextSerial;
    execute(state, source);
    const token = liveCards(state).find(card => card.token && card.owner === owner);
    assert.ok(token);
    assert.equal(token.id, 'STD-092');
    assert.equal(token.identity.instanceId, `i:${before}`);
    assert.equal(state.runtimeContext.identityState.nextSerial, before + 1);
    audit(state);
  }
});

test('S02-SESSION-08: each individual proxy generation family', () => {
  for (const [sourceId, generatedId, count] of [['STD-048', 'STD-050', 1], ['STD-049', 'STD-050', 1], ['STD-124', 'STD-124', 2], ['STD-106', 'STD-078', 1]]) {
    const state = fresh();
    const source = add(state, sourceId);
    const target = sourceId === 'STD-049' ? execute(state, add(state, 'STD-022', 'ai')) : null;
    if (source.color) {
      const symbol = add(state, sourceId); assert.equal(installCard(state, 'player', symbol.uid), true);
    }
    const before = state.runtimeContext.identityState.nextSerial;
    ability(state, source, 'proxy', target ? { targetUid: target.uid } : {});
    const generated = liveCards(state).filter(card => Number(card.identity.instanceId.slice(2)) >= before);
    assert.equal(generated.length, count);
    assert.ok(generated.every(card => card.id === generatedId));
    assert.equal(source.identity.matchId, 'match-a');
    audit(state);
  }
});

test('S02-SESSION-09: ghost generation through real spell selection', () => {
  const state = fresh();
  const victim = execute(state, add(state, 'STD-022'));
  const spell = add(state, 'STD-122');
  const before = state.runtimeContext.identityState.nextSerial;
  execute(state, spell);
  assert.equal(state.pending.request.continuation.type, 'technology-horizon');
  answer(state, { selected: [victim.uid] });
  const ghosts = liveCards(state).filter(card => Number(card.identity.instanceId.slice(2)) >= before);
  assert.equal(ghosts.length, 2);
  assert.ok(ghosts.every(card => card.id === 'STD-123'));
  assert.deepEqual(findCard(state, victim.uid).card.identity, victim.identity);
  audit(state);
});

test('S02-SESSION-10: random Ob update uses one RNG draw and one allocation', () => {
  const state = fresh();
  const source = execute(state, add(state, 'STD-237'));
  const before = structuredClone(state.runtimeContext);
  ability(state, source, 'update');
  assert.equal(state.runtimeContext.rngState.draws, before.rngState.draws + 1);
  assert.equal(state.runtimeContext.identityState.nextSerial, before.identityState.nextSerial + 1);
  const generated = audit(state).find(card => card.identity.instanceId === `i:${before.identityState.nextSerial}`);
  assert.ok(generated);
  assert.notEqual(generated.id, 'STD-237');
  assert.equal(state.events.some(event => event.cardUid === generated.uid && event.type === 'card_executed'), false);
});

test('S02-SESSION-11: generic hand and area generation operations', () => {
  for (const [sourceId, ids, zone] of [['STD-206', ['STD-189', 'STD-205'], 'hand'], ['STD-233', ['STD-234', 'STD-235'], 'hand'], ['STD-198', ['STD-189', 'STD-189', 'STD-189'], 'area']]) {
    const state = fresh();
    const source = add(state, sourceId);
    const before = state.runtimeContext.identityState.nextSerial;
    execute(state, source, sourceId === 'STD-198' ? { zone: 'back' } : {});
    const generated = audit(state).filter(card => Number(card.identity.instanceId.slice(2)) >= before);
    assert.deepEqual(generated.map(card => card.id).sort(), [...ids].sort());
    assert.ok(generated.every(card => zone === 'hand' ? state.players.player.hand.includes(card) : ['front', 'back'].includes(findCard(state, card.uid).zoneName)));
  }
});

test('S02-SESSION-12: movement-trigger generation preserves source identity', () => {
  const state = fresh();
  const symbol = add(state, 'STD-191'); assert.equal(installCard(state, 'player', symbol.uid), true);
  const source = execute(state, add(state, 'STD-194'));
  const identity = { ...source.identity };
  const before = state.runtimeContext.identityState.nextSerial;
  assert.equal(relogCard(state, 'player', source.uid, 'back'), true);
  assert.deepEqual(source.identity, identity);
  assert.equal(state.runtimeContext.identityState.nextSerial, before + 1);
  assert.ok(state.players.player.front.some(card => card.id === 'STD-189' && card.identity.instanceId === `i:${before}`));
  audit(state);
});

test('S02-SESSION-13: both-seat attack junk generation', () => {
  for (const owner of ['player', 'ai']) {
    const state = fresh();
    const source = execute(state, add(state, 'STD-106', owner));
    startTurn(state, owner);
    const before = state.runtimeContext.identityState.nextSerial;
    assert.equal(attack(state, owner, source.uid, `${owner === 'player' ? 'ai' : 'player'}-fortress`), true);
    const generated = audit(state).filter(card => Number(card.identity.instanceId.slice(2)) >= before);
    assert.equal(generated.length, 2);
    assert.ok(generated.every(card => card.id === 'STD-078' && card.owner === owner));
  }
});

test('S02-SESSION-14: Jacket post-spell continuation allocates only the real new card', () => {
  const state = fresh();
  const material = add(state, 'SZTB-090');
  const host = add(state, 'SZTB-092');
  assert.equal(playLayeredCard(state, 'player', host.uid, [material.uid]), true);
  const source = add(state, 'SZTB-099');
  const before = state.runtimeContext.identityState.nextSerial;
  execute(state, source);
  if (state.pending?.request?.continuation?.type === 'play-card-magazine-confirm') answer(state, { scope: '使用しない' });
  assert.equal(state.pending.request.continuation.type, 'sztb-jacket-place');
  answer(state, { scope: 'バック' });
  assert.equal(state.runtimeContext.identityState.nextSerial, before + 1);
  assert.ok(state.players.player.back.some(card => card.id === 'SZTB-091' && card.identity.instanceId === `i:${before}`));
  audit(state);
});

test('S02-SESSION-15: turn-start and event-layer generation share the same allocator', () => {
  const state = fresh();
  for (const id of ['SZTB-100', 'SZTB-101']) {
    const provider = execute(state, add(state, id), { zone: 'back' });
    assert.equal(activateScript(state, 'player', provider.uid), true);
  }
  const material = add(state, 'SZTB-090');
  const host = add(state, 'SZTB-092');
  const beforeLogin = state.runtimeContext.identityState.nextSerial;
  assert.equal(playLayeredCard(state, 'player', host.uid, [material.uid]), true);
  assert.ok(host.mounted.some(card => card.id === 'SZTB-090' && card.identity.instanceId === `i:${beforeLogin}`));
  const beforeTurn = state.runtimeContext.identityState.nextSerial;
  startTurn(state, 'player');
  assert.equal(state.runtimeContext.identityState.nextSerial, beforeTurn + 1);
  const beforeAttack = state.runtimeContext.identityState.nextSerial;
  assert.equal(attack(state, 'player', host.uid, 'ai-fortress'), true);
  assert.equal(state.runtimeContext.identityState.nextSerial, beforeAttack + 1);
  assert.ok(host.mounted.some(card => card.identity.instanceId === `i:${beforeAttack}`));
  audit(state);
});

test('S02-SESSION-16: full-board virtual token cards stay live in trash', () => {
  const state = fresh();
  state.players.player.user.frontLimit = 1;
  state.players.player.user.backLimit = 0;
  const source = add(state, 'STD-093');
  const before = state.runtimeContext.identityState.nextSerial;
  execute(state, source);
  const token = liveCards(state).find(card => card.identity.instanceId === `i:${before}`);
  assert.ok(token);
  assert.equal(token.id, 'STD-092');
  assert.equal(token.virtual, true);
  assert.ok(state.players.player.trash.includes(token));
  audit(state);
});

test('S02-SESSION-17: full-board ordinary generation stays live in trash and BAN', () => {
  for (const destination of ['trash', 'ban']) {
    const state = fresh();
    state.players.player.user.frontLimit = 1;
    state.players.player.user.backLimit = 0;
    const source = execute(state, add(state, 'STD-237'));
    if (destination === 'ban') state.players.player.trashBanUntilTurn = state.turnNumber;
    const before = state.runtimeContext.identityState.nextSerial;
    ability(state, source, 'update');
    assert.ok(state.players.player[destination].some(card => card.identity.instanceId === `i:${before}`));
    audit(state);
  }
});

test('S02-SESSION-18: owner and current controller differ without reissuing identity', () => {
  const state = fresh();
  const proof = execute(state, add(state, 'STD-228'));
  const identity = { ...proof.identity };
  const before = state.runtimeContext.identityState.nextSerial;
  ability(state, proof, 'update');
  const moved = findCard(state, proof.uid);
  assert.equal(moved.playerId, 'ai');
  assert.equal(moved.card.owner, 'player');
  assert.equal(moved.card.ownerSeat, 'seat-a');
  assert.deepEqual(moved.card.identity, identity);
  assert.equal(state.runtimeContext.identityState.nextSerial, before);
  audit(state);
});

test('S02-SESSION-19: actual forced execution retains identity through hydration', () => {
  const state = fresh();
  const symbol = add(state, 'STD-091'); assert.equal(installCard(state, 'player', symbol.uid), true);
  const script = execute(state, add(state, 'STD-105'), { zone: 'back' });
  const forced = add(state, 'STD-195');
  const attacker = execute(state, add(state, 'STD-020', 'ai'));
  startTurn(state, 'ai');
  assert.equal(attack(state, 'ai', attacker.uid, 'player-fortress'), true);
  assert.equal(state.prompt.scriptUid, script.uid);
  const identity = { ...forced.identity };
  const before = state.runtimeContext.identityState.nextSerial;
  assert.equal(activateScript(state, 'player', script.uid, { selectionUid: forced.uid }), true);
  const hydrated = findCard(state, forced.uid).card;
  assert.notEqual(hydrated, forced);
  assert.deepEqual(hydrated.identity, identity);
  assert.equal(hydrated.ownerSeat, 'seat-a');
  assert.equal(state.runtimeContext.identityState.nextSerial, before);
  audit(state);
});

test('S02-SESSION-20: LKI continuation needs a registered source and never allocates it', () => {
  const state = fresh();
  const source = execute(state, add(state, 'STD-200'));
  assert.equal(state.pending.request.continuation.type, 'runtime-zone-choice');
  const continuation = state.pending.request.continuation;
  const alias = state.runtimeContext.uidAliases.find(entry => entry.uid === source.uid);
  const before = state.runtimeContext.identityState.nextSerial;
  answer(state, { scope: 'back' });
  assert.equal(state.runtimeContext.identityState.nextSerial, before + 1); // Footprint, not LKI.
  assert.deepEqual(alias.identity, source.identity);
  assert.notEqual(alias.identity, source.identity);
  audit(state);
  const broken = fresh();
  const brokenSource = execute(broken, add(broken, 'STD-200'));
  broken.runtimeContext.uidAliases = broken.runtimeContext.uidAliases.filter(entry => entry.uid !== brokenSource.uid);
  throwsCode(() => answer(broken, { scope: 'back' }), 'RUNTIME_UNKNOWN_SOURCE_ALIAS');
  assert.equal(continuation.sourceUid, source.uid);
});

test('S02-SESSION-21: independent history RNG, allocator, aliases and unsupported undo', () => {
  const state = fresh();
  const original = structuredClone(state.runtimeContext);
  const copy = cloneForHistory(state);
  assert.notEqual(copy.rng, state.rng);
  assert.notEqual(copy.runtimeContext, state.runtimeContext);
  const expected = nextRng(original.rngState);
  assert.equal(copy.rng(), expected.value.value);
  assert.deepEqual(copy.runtimeContext.rngState, expected.value.state);
  assert.deepEqual(state.runtimeContext, original);
  const card = add(copy, 'STD-020', 'ai');
  assert.equal(card.identity.instanceId, `i:${original.identityState.nextSerial}`);
  assert.deepEqual(state.runtimeContext, original);
  assert.notEqual(copy.runtimeContext.uidAliases[0], state.runtimeContext.uidAliases[0]);
  assert.notEqual(copy.runtimeContext.uidAliases[0].identity, state.runtimeContext.uidAliases[0].identity);
  audit(copy);
  remember(state);
  const history = state.history;
  const prior = history[0];
  const before = cloneForHistory(state);
  throwsCode(() => undo(state), 'RUNTIME_UNDO_UNSUPPORTED');
  assert.equal(state.history, history);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0], prior);
  assert.deepEqual(cloneForHistory(state).runtimeContext, before.runtimeContext);
  assert.deepEqual(state.players, before.players);
});

test('S02-SESSION-22: typed exhaustion and invalid RNG propagate before context consumption', () => {
  const state = fresh();
  state.runtimeContext.identityState.nextSerial = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(state.runtimeContext);
  throwsCode(() => addSandboxCardToHand(state, 'player', 'STD-020'), 'IDENTITY_EXHAUSTED');
  assert.deepEqual(state.runtimeContext, before);
  const last = fresh();
  last.runtimeContext.identityState.nextSerial = Number.MAX_SAFE_INTEGER - 1;
  const lastBefore = structuredClone(last.runtimeContext);
  throwsCode(() => expandRuntimeDeck(last.runtimeContext, [['STD-020', 2]], 'player'), 'IDENTITY_EXHAUSTED');
  assert.deepEqual(last.runtimeContext, lastBefore);
  const rngState = { schemaVersion: 1, algorithm: 'mulberry32-v1', seed: 0, cursor: 2463401483, draws: Number.MAX_SAFE_INTEGER };
  state.runtimeContext.rngState = rngState;
  throwsCode(() => state.rng(), 'RNG_EXHAUSTED');
  assert.equal(state.runtimeContext.rngState, rngState);
  state.runtimeContext.rngState = { ...rngState, algorithm: 'unknown' };
  throwsCode(() => state.rng(), 'RNG_UNSUPPORTED_FORMAT');
  state.runtimeContext.rngState = { ...rngState, cursor: 1 };
  throwsCode(() => state.rng(), 'RNG_INVALID_INPUT');
});

test('S02-SESSION-23: legacy engine retains UID and injected RNG behavior', () => {
  let draws = 0;
  const rng = () => { draws += 1; return 0.5; };
  const state = createGame({ mode: 'sandbox', rng });
  assert.ok(draws > 0); // Legacy still builds and shuffles the original decks.
  assert.equal(state.rng, rng);
  assert.equal(Object.hasOwn(state, 'runtimeContext'), false);
  const initial = state.players.player.front[0];
  assert.equal(initial.uid, 'player-STD-020-lab-101');
  assert.equal(Object.hasOwn(initial, 'identity'), false);
  assert.equal(Object.hasOwn(initial, 'ownerSeat'), false);
  const copy = cloneForHistory(state);
  assert.equal(copy.rng, rng);
  remember(state);
  assert.equal(undo(state).rng, rng);
});

test('S02-SESSION-24: opponent placement replacement mounts the existing individual', () => {
  const state = fresh();
  const symbol = add(state, 'STD-191'); assert.equal(installCard(state, 'player', symbol.uid), true);
  const script = execute(state, add(state, 'STD-204'), { zone: 'back' });
  startTurn(state, 'ai');
  const victim = add(state, 'STD-022', 'ai');
  const identity = { ...victim.identity };
  const before = state.runtimeContext.identityState.nextSerial;
  execute(state, victim);
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(activateScript(state, 'player', script.uid), true);
  const host = state.players.player.front.find(card => card.id === 'STD-205');
  assert.ok(host);
  assert.equal(host.identity.instanceId, `i:${before}`);
  assert.deepEqual(host.mounted[0].identity, identity);
  assert.equal(host.mounted[0].ownerSeat, 'seat-b');
  assert.equal(host.ownerSeat, 'seat-a');
  assert.equal(state.runtimeContext.identityState.nextSerial, before + 1);
  audit(state);
});

test('S02-SESSION-25: adjacent generation owns proofs by source seat on the other board', () => {
  const state = fresh();
  const symbol = add(state, 'STD-214'); assert.equal(installCard(state, 'player', symbol.uid), true);
  const script = execute(state, add(state, 'STD-231'), { zone: 'back' });
  startTurn(state, 'ai');
  const victim = add(state, 'STD-022', 'ai');
  const before = state.runtimeContext.identityState.nextSerial;
  execute(state, victim, { requestedSlot: 2 });
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(activateScript(state, 'player', script.uid), true);
  const proofs = state.players.ai.front.filter(card => card.id === 'STD-228');
  assert.deepEqual(proofs.map(card => card.boardSlot).sort(), [1, 3]);
  assert.ok(proofs.every(card => card.owner === 'player' && card.ownerSeat === 'seat-a'));
  assert.equal(state.runtimeContext.identityState.nextSerial, before + 2);
  audit(state);
});

test('S02-SESSION-26: Patchwork and delayed respawn generation use real public continuations', () => {
  const patchwork = fresh();
  const source = add(patchwork, 'STD-207');
  const before = patchwork.runtimeContext.identityState.nextSerial;
  execute(patchwork, source);
  assert.equal(patchwork.pending.request.continuation.type, 'std207-reveal');
  const doll = patchwork.players.player.hand.find(card => card.identity.instanceId === `i:${before}`);
  answer(patchwork, { selected: [doll.uid] });
  assert.equal(doll.id, 'STD-189');
  assert.equal(doll.revealed, true);
  audit(patchwork);

  const respawn = fresh();
  const victim = execute(respawn, add(respawn, 'STD-189'));
  execute(respawn, add(respawn, 'STD-212'));
  assert.equal(destroyCard(respawn, 'player', victim.uid, { source: 'test', suppressReplacement: true }), true);
  assert.equal(endTurn(respawn), false);
  assert.equal(respawn.pending.request.continuation.type, 'std212-respawn-count');
  const next = respawn.runtimeContext.identityState.nextSerial;
  answer(respawn, { scope: '1' });
  assert.ok(respawn.players.player.front.some(card => card.identity.instanceId === `i:${next}` && card.id === 'STD-189'));
  audit(respawn);
});

test('S02-SESSION-27: random generation followed by forced execution registers one card', () => {
  const state = fresh();
  const source = execute(state, add(state, 'STD-170'));
  const before = structuredClone(state.runtimeContext);
  ability(state, source, 'update');
  assert.equal(state.runtimeContext.rngState.draws, before.rngState.draws + 1);
  assert.equal(state.runtimeContext.identityState.nextSerial, before.identityState.nextSerial + 1);
  const generated = audit(state).find(card => card.identity.instanceId === `i:${before.identityState.nextSerial}`);
  assert.ok(['STD-165', 'STD-171', 'STD-172'].includes(generated.id));
  assert.ok(['front', 'back'].includes(findCard(state, generated.uid).zoneName));
});

test('S02-SESSION-28: paused script declaration copies identity without allocation', () => {
  const state = fresh();
  const blocker = execute(state, add(state, 'STD-003', 'ai'), { zone: 'back' });
  const source = execute(state, add(state, 'STD-036'), { zone: 'back' });
  const before = state.runtimeContext.identityState.nextSerial;
  assert.equal(activateScript(state, 'player', source.uid), true);
  assert.equal(state.prompt.scriptUid, blocker.uid);
  const snapshot = state.resolvingDeclaredEffect.sourceSnapshot;
  assert.deepEqual(snapshot.identity, source.identity);
  assert.notEqual(snapshot.identity, source.identity);
  assert.equal(Object.isFrozen(snapshot.identity), true);
  assert.equal(snapshot.ownerSeat, source.ownerSeat);
  assert.equal(state.runtimeContext.identityState.nextSerial, before);
  assert.equal(declinePrompt(state), true);
  assert.ok(state.players.player.trash.some(card => card.uid === source.uid));
  assert.ok(state.events.some(event => event.type === 'script_activated' && event.cardUid === source.uid));
  audit(state);
});

test('S02-SESSION-29: user and deck identifiers use own definitions with no recipe-count rule', () => {
  for (const playerUserId of Object.keys(USER_CARDS)) {
    const state = game({ playerUserId, mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-022', 1]], aiDeckRecipe: [['STD-023', 1]] });
    assert.equal(audit(state).length, 2);
  }
  assert.ok(Object.hasOwn(CARD_LIBRARY, 'STD-022'));
});

test('S02-SESSION-30: Imperial attack generates opponent-owned proofs after destruction', () => {
  const state = fresh();
  const colors = new Set();
  for (const definition of Object.values(CARD_LIBRARY)) {
    if (!definition.color || colors.has(definition.color) || definition.id === 'STD-224') continue;
    colors.add(definition.color);
    const provider = add(state, definition.id);
    assert.equal(installCard(state, 'player', provider.uid, { force: true }), true);
  }
  assert.equal(colors.size, 7);
  const source = execute(state, add(state, 'STD-227'));
  const victim = execute(state, add(state, 'STD-022', 'ai'));
  startTurn(state, 'player');
  const before = state.runtimeContext.identityState.nextSerial;
  assert.equal(attack(state, 'player', source.uid, 'ai-fortress'), true);
  const proof = state.players.ai.front.find(card => card.identity.instanceId === `i:${before}`);
  assert.ok(proof);
  assert.equal(proof.id, 'STD-228');
  assert.equal(proof.ownerSeat, 'seat-b');
  assert.ok(state.players.ai.trash.some(card => card.uid === victim.uid));
  audit(state);
});
