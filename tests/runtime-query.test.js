import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LIBRARY, USER_CARDS } from '../src/data/cards.js';
import { queryRuntimeSeat, queryRuntimeCard, queryRuntimeCards } from '../src/game/runtime/query.js';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { retireInstanceId } from '../src/game/runtime/identity.js';
import {
  activateCardEffect, activateResponse, activateScript, activateTurbo, addSandboxCardToHand,
  cardAtk, cardMaxStr, cardCurrentStr, cardHasKeyword, cloneForHistory, dealCardDamage,
  dealFortressDamage, declinePrompt, declineResponse, destroyCard, enabledSymbols, executionCost,
  getActivatableEffects, getMaxMemory, installCard, playCard, resolveCardSelection, startTurn
} from '../src/game/engine.js';

function game(gameOptions = {}) {
  const result = createRuntimeSession({ matchId: 'query-match', seatIds: ['seat-a', 'seat-b'], seed: 0, ruleVersion: 'rules', cardVersion: 'cards', gameOptions });
  assert.equal(result.ok, true);
  return result.value.engineState;
}
const fresh = (options = {}) => game({ mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-022', 12]], aiDeckRecipe: [['STD-022', 12]], ...options });
function add(state, id, owner = 'player') {
  assert.equal(addSandboxCardToHand(state, owner, id), true);
  return state.players[owner].hand.at(-1);
}
function execute(state, card, options = {}) {
  assert.equal(playCard(state, card.owner, card.uid, { free: true, force: true, ignoreColor: true, ...options }), true);
  return card;
}
function symbol(state, id, owner = 'player') {
  const card = add(state, id, owner);
  assert.equal(installCard(state, owner, card.uid, { force: true }), true);
  return card;
}
function answer(state, selected = []) {
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected }), true);
}
function snapshot(input, seen = new Map()) {
  if (input === null || typeof input !== 'object') return input;
  if (seen.has(input)) return { shared: seen.get(input) };
  seen.set(input, seen.size);
  return { prototype: Object.getPrototypeOf(input), descriptors: Reflect.ownKeys(input).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return [key, Object.hasOwn(descriptor, 'value') ? { ...descriptor, value: snapshot(descriptor.value, seen) } : descriptor];
  }) };
}
function invoke(query, state, args) {
  const before = snapshot(state);
  const argsBefore = snapshot(args);
  const result = query(state, args);
  assert.deepEqual(snapshot(state), before);
  assert.deepEqual(snapshot(args), argsBefore);
  return result;
}
function cardQuery(state, card, names = ['SECURITY', 'HACKING', 'CONTACT', 'ENCRYPTION', 'unknown']) {
  const result = invoke(queryRuntimeCard, state, { identity: { ...card.identity }, keywordNames: names });
  assert.equal(result.ok, true);
  const value = result.value;
  const controller = value.controllerSeat === 'seat-a' ? 'player' : 'ai';
  const { components, ...computed } = value.computed;
  assert.equal(Array.isArray(components), true);
  assert.deepEqual(computed, {
    executionCost: executionCost(card, state, controller), atk: cardAtk(state, controller, card),
    maxStr: cardMaxStr(state, controller, card), currentStr: cardCurrentStr(state, controller, card),
    keywords: names.map(name => ({ name, enabled: cardHasKeyword(state, controller, card, name) }))
  });
  return value;
}
function seatQuery(state, seatId) {
  const result = invoke(queryRuntimeSeat, state, { seatId });
  assert.equal(result.ok, true);
  return result.value;
}
const fail = (query, state, args, code) => assert.deepEqual(invoke(query, state, args), { ok: false, error: { code } });
function freeze(input, seen = new Set()) {
  if (input && typeof input === 'object' && !seen.has(input)) {
    seen.add(input);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if (Object.hasOwn(descriptor, 'value')) freeze(descriptor.value, seen);
    Object.freeze(input);
  }
  return input;
}

test('S02-QUERY-01: all startup modes and both seats expose complete independent summaries', () => {
  for (const options of [{}, { mode: 'tutorial' }, { mode: 'tutorial', tutorialId: 'vengeance' }, { mode: 'lab' }, { mode: 'sandbox' }, { mode: 'sandbox', sandboxDeckSetup: true }]) {
    const state = game(options);
    for (const [id, seatId] of [['player', 'seat-a'], ['ai', 'seat-b']]) {
      const player = state.players[id];
      const value = seatQuery(state, seatId);
      assert.deepEqual(Object.keys(value), ['matchId', 'seatId', 'activeSeat', 'turnNumber', 'fortressStr', 'memory', 'turboActive', 'enabledSymbols', 'counts']);
      assert.equal(value.activeSeat, 'seat-a');
      assert.deepEqual(value.memory, { current: player.memory, max: getMaxMemory(player) });
      assert.deepEqual(value.enabledSymbols, enabledSymbols(player));
      assert.deepEqual(value.counts, Object.fromEntries(['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban'].map(zone => [zone, player[zone].length])));
      for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) for (const card of player[zone]) cardQuery(state, card, []);
    }
  }
});

test('S02-QUERY-02: printed definition stays separate from mutable card stats and has null defaults', () => {
  const state = fresh();
  const card = add(state, 'STD-003');
  const value = cardQuery(state, card);
  assert.deepEqual(Object.keys(value), ['identity', 'ownerSeat', 'controllerSeat', 'location', 'definition', 'state', 'computed']);
  assert.deepEqual(value.definition, { id: 'STD-003', name: CARD_LIBRARY['STD-003'].name, category: 'Script', printedCategory: 'Script', color: null, cost: 3, atk: null, str: null, text: CARD_LIBRARY['STD-003'].text, classes: [] });
  assert.deepEqual(value.state, { faceDown: false, sleep: false, summoningSick: true, token: false, virtual: false, residentActive:false, damage: 0, protect: 0, backup: 0, load: 0, counters: {} });
  const plugin = symbol(state, 'STD-004');
  assert.equal(cardQuery(state, plugin).definition.cost, null);
  assert.equal(seatQuery(state, 'seat-a').memory.max, getMaxMemory(state.players.player));
});

test('S05-QUERY-02A: batch card query preserves order and matches individual public values', () => {
  const state = fresh();
  const first = add(state, 'STD-020');
  const second = add(state, 'STD-022');
  const keywordNames = ['SECURITY', 'CONTACT'];
  const result = invoke(queryRuntimeCards, state, {
    identities: [{ ...first.identity }, { ...second.identity }], keywordNames
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value, [cardQuery(state, first, keywordNames), cardQuery(state, second, keywordNames)]);
  fail(queryRuntimeCards, state, {
    identities: [{ ...first.identity }, { ...first.identity }], keywordNames
  }, 'RUNTIME_INVALID_QUERY_INPUT');
});

test('S02-QUERY-03: both-seat providers, trash-name discounts and user abilities change current costs', () => {
  const watching = Object.keys(USER_CARDS).find(id => USER_CARDS[id].abilityKey === 'watching_you');
  const state = fresh({ playerUserId: watching });
  const card = add(state, 'STD-020');
  const baseline = cardQuery(state, card).computed.executionCost;
  execute(state, add(state, 'STD-008', 'ai'), { zone: 'back' });
  assert.equal(cardQuery(state, card).computed.executionCost, baseline + 1);
  const matching = execute(state, add(state, 'STD-020'));
  assert.equal(destroyCard(state, 'player', matching.uid, { suppressReplacement: true }), true);
  symbol(state, 'STD-007');
  assert.equal(cardQuery(state, card).computed.executionCost, baseline);
  cardQuery(state, add(state, 'STD-003'));
  cardQuery(state, add(state, 'STD-020', 'ai'));
});

test('S02-QUERY-04: mounted modifiers and keyword grants use the direct host controller', () => {
  const state = fresh();
  const host = execute(state, add(state, 'STD-020'));
  const mounted = execute(state, add(state, 'STD-079'), { underUid: host.uid });
  const value = cardQuery(state, host);
  assert.equal(value.computed.atk, 4);
  assert.equal(value.computed.keywords.find(row => row.name === 'CONTACT').enabled, true);
  assert.deepEqual(cardQuery(state, mounted).location, { kind: 'mounted', host: { ...host.identity }, order: 1, role: 'mount' });
});

test('S02-QUERY-05: aura and position-dependent keywords use full runtime helpers', () => {
  const state = fresh();
  const fairy = execute(state, add(state, 'STD-124'));
  execute(state, add(state, 'STD-115'), { zone: 'back' });
  assert.equal(cardQuery(state, fairy).computed.keywords.find(row => row.name === 'ENCRYPTION').enabled, true);
  const front = execute(state, add(state, 'STD-117'));
  assert.equal(cardQuery(state, front).computed.keywords.find(row => row.name === 'HACKING').enabled, true);
});

test('S02-QUERY-06: a real generated threshold ghost exposes conditional QA and HACKING', () => {
  const state = fresh();
  for (let count = 0; count < 2; count += 1) {
    const copy = execute(state, add(state, 'STD-124'));
    assert.equal(destroyCard(state, 'player', copy.uid, { suppressReplacement: true }), true);
  }
  const fairy = execute(state, add(state, 'STD-124'));
  execute(state, add(state, 'STD-122'));
  answer(state, [fairy.uid]);
  const ghosts = [...state.players.player.front, ...state.players.player.back].filter(card => card.id === 'STD-123');
  assert.equal(ghosts.length, 2);
  for (const ghost of ghosts) {
    const value = cardQuery(state, ghost, ['QA', 'HACKING', 'qa']);
    assert.deepEqual(value.computed.keywords, [{ name: 'QA', enabled: true }, { name: 'HACKING', enabled: true }, { name: 'qa', enabled: false }]);
    assert.equal(value.computed.atk, 6);
  }
});

test('S02-QUERY-07: turbo and registry memory providers have current seat values', () => {
  const turbo = Object.keys(USER_CARDS).find(id => USER_CARDS[id].abilityKey === 'turbo');
  const state = fresh({ playerUserId: turbo });
  symbol(state, 'STD-005');
  const before = seatQuery(state, 'seat-a');
  assert.equal(activateTurbo(state, 'player'), true);
  const after = seatQuery(state, 'seat-a');
  assert.equal(after.turboActive, true);
  assert.equal(after.memory.max, before.memory.max + 2);
  assert.equal(after.memory.current, before.memory.current + 2);
});

test('S02-QUERY-08: public damage and Load operations affect current stats without altering print', () => {
  const state = fresh();
  const target = execute(state, add(state, 'STD-022', 'ai'));
  assert.equal(dealCardDamage(state, 'ai', target.uid, 1, 'query test', { sourcePlayerId: 'player' }), true);
  assert.equal(cardQuery(state, target).computed.currentStr, 3);
  symbol(state, 'STD-169');
  const source = add(state, 'STD-169');
  const proxy = getActivatableEffects(state, 'player', source).find(effect => effect.kind === 'proxy');
  assert.equal(activateCardEffect(state, 'player', source.uid, proxy.id, { targetUid: target.uid }), true);
  const value = cardQuery(state, target);
  assert.equal(value.state.load, 3);
  assert.equal(value.definition.str, 4);
});

test('S02-QUERY-09: real timed stat grants expire while legacy keyword expiry semantics stay unchanged', () => {
  const state = fresh();
  symbol(state, 'STD-139');
  const target = execute(state, add(state, 'STD-020'));
  const script = execute(state, add(state, 'STD-139'), { zone: 'back' });
  assert.equal(activateScript(state, 'player', script.uid), true);
  answer(state, [target.uid]);
  assert.equal(cardQuery(state, target).computed.atk, 0);
  // A bounded read-only expiry fixture retains the engine's timed keyword behavior.
  const expired = cloneForHistory(state);
  expired.turnNumber += 1;
  const copied = expired.players.player.front.find(card => card.uid === target.uid);
  assert.equal(cardQuery(expired, copied).computed.atk, 2);
  assert.equal(cardQuery(expired, copied).computed.keywords.find(row => row.name === 'SECURITY').enabled, true);
});

test('S02-QUERY-10: foreign controller and virtual token retain original ownership', () => {
  const state = fresh();
  const proof = execute(state, add(state, 'STD-228'));
  const update = getActivatableEffects(state, 'player', proof).find(effect => effect.kind === 'update');
  assert.equal(activateCardEffect(state, 'player', proof.uid, update.id), true);
  const value = cardQuery(state, proof);
  assert.equal(value.ownerSeat, 'seat-a');
  assert.equal(value.controllerSeat, 'seat-b');
  execute(state, add(state, 'STD-093'));
  const token = [...state.players.player.front, ...state.players.player.back].find(card => card.token);
  assert.equal(cardQuery(state, token).state.virtual, true);
  assert.equal(destroyCard(state, 'player', token.uid, { suppressReplacement: true }), true);
  assert.equal(cardQuery(state, token).location.zone, 'trash');
});

test('S02-QUERY-11: decode and Sp pending sources are resolved by exact inflight keys', () => {
  const state = fresh();
  const material = execute(state, add(state, 'STD-020'));
  assert.equal(destroyCard(state, 'player', material.uid, { suppressReplacement: true }), true);
  const decode = execute(state, add(state, 'STD-041'));
  assert.equal(destroyCard(state, 'player', decode.uid, { suppressReplacement: true }), true);
  answer(state, [material.uid]);
  assert.deepEqual(cardQuery(state, material).location, { kind: 'inflight', storageKey: 'pending.decode-place.cards/0' });
  const spellState = fresh();
  execute(spellState, add(spellState, 'STD-020'));
  const target = execute(spellState, add(spellState, 'STD-022', 'ai'));
  const spell = execute(spellState, add(spellState, 'STD-086'), { targetUid: target.uid });
  assert.deepEqual(cardQuery(spellState, spell).location, { kind: 'inflight', storageKey: 'deferredSpellCleanup/card' });
  answer(spellState);
  assert.equal(cardQuery(spellState, spell).location.zone, 'trash');
});

test('S02-QUERY-12: Response declaration, resolving source and deferred cleanup each resolve once', () => {
  const state = fresh(); state.interactive = true;
  symbol(state, 'STD-143');
  const blocker = execute(state, add(state, 'STD-003', 'ai'), { zone: 'back' });
  execute(state, add(state, 'STD-020', 'ai'));
  const response = add(state, 'STD-143'); add(state, 'STD-034');
  startTurn(state, 'ai'); dealFortressDamage(state, 'player', 1, 'ai', 'query response');
  assert.equal(activateResponse(state, 'player', response.uid), true);
  assert.equal(cardQuery(state, response).location.storageKey, 'declaredEffects/0/card');
  assert.equal(declineResponse(state, 'player'), true);
  assert.equal(state.prompt.scriptUid, blocker.uid);
  assert.equal(cardQuery(state, response).location.storageKey, 'deferredTrashMoves/0/card');
  assert.equal(activateScript(state, 'ai', blocker.uid), true);
  assert.equal(cardQuery(state, response).location.zone, 'trash');
  const later = execute(state, add(state, 'STD-020'));
  assert.equal(destroyCard(state, 'player', later.uid), true);
  assert.equal(cardQuery(state, later).location.zone, 'ban');
  const resolving = fresh(); resolving.interactive = true;
  const ownBlocker = execute(resolving, add(resolving, 'STD-003'), { zone: 'back' });
  const target = execute(resolving, add(resolving, 'STD-020', 'ai'));
  const answerCard = add(resolving, 'STD-034');
  dealFortressDamage(resolving, 'player', 1, 'ai', 'query response');
  assert.equal(activateResponse(resolving, 'player', answerCard.uid, target.uid), true);
  assert.equal(resolving.prompt.scriptUid, ownBlocker.uid);
  assert.equal(cardQuery(resolving, answerCard).location.storageKey, 'resolvingDeclaredEffect/card');
  assert.equal(declinePrompt(resolving), true);
});

test('S02-QUERY-13: unknown seats, other matches, unissued and retired identities fail without writes', () => {
  const state = fresh(); const card = state.players.player.hand[0];
  fail(queryRuntimeSeat, state, { seatId: 'other' }, 'SEAT_MISMATCH');
  fail(queryRuntimeCard, state, { identity: { matchId: 'other', instanceId: card.identity.instanceId }, keywordNames: [] }, 'MATCH_MISMATCH');
  fail(queryRuntimeCard, state, { identity: { matchId: 'query-match', instanceId: 'i:999999' }, keywordNames: [] }, 'UNKNOWN_INSTANCE');
  const retired = cloneForHistory(state);
  const retiring = retired.players.player.hand.shift();
  retired.runtimeContext.identityState = retireInstanceId(retired.runtimeContext.identityState, retiring.identity).value;
  fail(queryRuntimeCard, retired, { identity: { ...retiring.identity }, keywordNames: [] }, 'UNKNOWN_INSTANCE');
  const duplicate = cloneForHistory(state); duplicate.players.player.trash.push(duplicate.players.player.hand[0]);
  fail(queryRuntimeSeat, duplicate, { seatId: 'seat-a' }, 'DUPLICATE_INSTANCE');
});

test('S02-QUERY-14: exact argument descriptors, canonical identities and dense unique keyword names', () => {
  const state = fresh(); const identity = { ...state.players.player.hand[0].identity };
  for (const args of [null, {}, { seatId: '' }, { seatId: 1 }, { seatId: 'seat-a', extra: 1 }, Object.assign(Object.create(null), { seatId: 'seat-a' })]) fail(queryRuntimeSeat, state, args, 'RUNTIME_INVALID_QUERY_INPUT');
  for (const args of [
    { identity, keywordNames: [], extra: 1 }, { identity: { ...identity, extra: 1 }, keywordNames: [] },
    { identity: { ...identity, instanceId: 'i:01' }, keywordNames: [] }, { identity, keywordNames: [''] },
    { identity, keywordNames: ['QA', 'QA'] }, { identity, keywordNames: [1] }, { identity, keywordNames: [, 'QA'] }
  ]) fail(queryRuntimeCard, state, args, 'RUNTIME_INVALID_QUERY_INPUT');
  const extra = []; extra.x = 1;
  fail(queryRuntimeCard, state, { identity, keywordNames: extra }, 'RUNTIME_INVALID_QUERY_INPUT');
});

test('S02-QUERY-15: required computation types and output flags/counters reject coercion and null', () => {
  const state = fresh(); const card = state.players.player.hand[0];
  const args = { identity: { ...card.identity }, keywordNames: [] };
  for (const change of [
    candidate => { candidate.turnNumber = '1'; }, candidate => { candidate.players.ai.baseMemory = null; },
    candidate => { candidate.players.player.memory = '99'; }, candidate => { candidate.players.player.fortressStr = Infinity; },
    candidate => { candidate.players.player.hand[0].cost = '3'; }, candidate => { candidate.players.player.hand[0].sleep = null; },
    candidate => { candidate.players.player.hand[0].load = -0; }, candidate => { candidate.players.player.hand[0].protect = null; },
    candidate => { candidate.players.player.hand[0].counters = null; }, candidate => { candidate.players.player.hand[0].counters = { x: 1.5 }; },
    candidate => { candidate.players.player.hand[0].timedModifiers = [{ atk: 1, expiresAfterTurn: '2' }]; },
    candidate => { candidate.players.player.hand[0].compiled = { keywords: [{ name: 'QA', intrinsic: 1 }] }; }
  ]) {
    const candidate = cloneForHistory(state); change(candidate);
    const query = typeof candidate.players.player.memory !== 'number' || !Number.isFinite(candidate.players.player.fortressStr) ? queryRuntimeSeat : queryRuntimeCard;
    fail(query, candidate, query === queryRuntimeSeat ? { seatId: 'seat-a' } : args, 'RUNTIME_INVALID_QUERY_STATE');
  }
});

test('S02-QUERY-16: helper nullish defaults and omitted output fields stay pure and prototype-safe', () => {
  const state = fresh(); const card = state.players.player.hand[0];
  // Bounded descriptor/default fixture, not a game command or card introduction.
  for (const key of ['tempAtk', 'permanentAtk', 'timedModifiers', 'grantedKeywords', 'compiled']) card[key] = null;
  delete card.sleep; delete card.load; delete card.backup; delete card.protect;
  card.counters = {};
  Object.defineProperty(card.counters, '__proto__', { value: 2, enumerable: true });
  const result = invoke(queryRuntimeCard, state, { identity: { ...card.identity }, keywordNames: ['unknown'] });
  assert.equal(result.ok, true);
  assert.equal(result.value.state.sleep, false);
  assert.equal(result.value.state.load, 0);
  assert.equal(Object.getPrototypeOf(result.value.state.counters), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result.value.state.counters, '__proto__').value, 2);
});

test('S02-QUERY-17: frozen inputs, repeated results and caller mutation never affect runtime state', () => {
  const state = fresh(); const host = execute(state, add(state, 'STD-020'));
  const child = execute(state, add(state, 'STD-078'), { underUid: host.uid });
  state.history.push({ sentinel: child, rng: state.rng });
  const expected = cardQuery(state, child);
  const candidate = freeze(cloneForHistory(state));
  const args = freeze({ identity: { ...child.identity }, keywordNames: ['SECURITY', 'HACKING', 'CONTACT', 'ENCRYPTION', 'unknown'] });
  const result = invoke(queryRuntimeCard, candidate, args);
  assert.deepEqual(result.value, expected);
  result.value.identity.instanceId = 'i:999'; result.value.location.host.instanceId = 'i:999';
  result.value.definition.classes.push('changed'); result.value.state.counters.x = 9;
  result.value.computed.keywords[0].enabled = !result.value.computed.keywords[0].enabled;
  assert.deepEqual(cardQuery(state, child), expected);
  const seat = seatQuery(state, 'seat-a'); seat.enabledSymbols.push('changed'); seat.counts.hand = 999;
  assert.notEqual(seatQuery(state, 'seat-a').counts.hand, 999);
});

test('S02-QUERY-18: relevant getters never run, unknown getters are ignored and reflection failures propagate', () => {
  const state = fresh(); const identity = { ...state.players.player.hand[0].identity }; let called = 0;
  const getter = { enumerable: true, configurable: true, get() { called += 1; throw new Error('getter'); } };
  const args = { seatId: 'seat-a' }; Object.defineProperty(args, 'seatId', getter);
  fail(queryRuntimeSeat, state, args, 'RUNTIME_INVALID_QUERY_INPUT');
  const keywords = ['QA']; Object.defineProperty(keywords, '0', getter);
  fail(queryRuntimeCard, state, { identity, keywordNames: keywords }, 'RUNTIME_INVALID_QUERY_INPUT');
  for (const [scope, key] of [['root', 'turnNumber'], ['player', 'baseMemory'], ['target', 'atk'], ['provider', 'faceDown']]) {
    const candidate = cloneForHistory(state);
    if (scope === 'provider') symbol(candidate, 'STD-004', 'ai');
    const object = scope === 'root' ? candidate : scope === 'player' ? candidate.players.ai : scope === 'provider' ? candidate.players.ai.registry[0] : candidate.players.player.hand[0];
    Object.defineProperty(object, key, getter);
    fail(queryRuntimeCard, candidate, { identity, keywordNames: [] }, 'RUNTIME_INVALID_QUERY_STATE');
  }
  Object.defineProperty(state, 'unrelated', getter);
  assert.equal(invoke(queryRuntimeSeat, state, { seatId: 'seat-a' }).ok, true);
  assert.equal(called, 0);
  const reflection = new Error('reflection');
  const proxy = new Proxy({ seatId: 'seat-a' }, { ownKeys() { throw reflection; } });
  assert.throws(() => queryRuntimeSeat(state, proxy), error => error === reflection);
  const candidate = cloneForHistory(fresh());
  candidate.players.ai.user = new Proxy(candidate.players.ai.user, { getOwnPropertyDescriptor() { throw reflection; } });
  assert.throws(() => queryRuntimeCard(candidate, { identity, keywordNames: [] }), error => error === reflection);
});
