import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeIdentityIndex } from '../src/game/runtime/bridge.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { projectRuntimeView } from '../src/game/runtime/projection.js';
import { executionCost } from '../src/game/engine.js';

const config = () => ({
  matchId: 'projection-match', seatIds: ['seat-a', 'seat-b'], seed: 7,
  ruleVersion: 'test-rule', cardVersion: 'test-cards',
  gameOptions: {
    mode: 'sandbox', sandboxDeckSetup: true,
    playerDeckRecipe: [['STD-022', 3], ['STD-007', 2], ['STD-008', 2], ['STD-100', 2], ['STD-227', 2]],
    aiDeckRecipe: [['STD-022', 3], ['STD-007', 2], ['STD-008', 2], ['STD-100', 2], ['STD-227', 2]]
  }
});

function game() {
  const result = createRuntimeSession(config());
  assert.equal(result.ok, true, JSON.stringify(result));
  const state = result.value.engineState;
  for (const player of [state.players.player, state.players.ai]) player.deck.push(...player.hand.splice(0));
  return state;
}

function allCards(state) {
  const result = [];
  const visit = card => { result.push(card); for (const child of card.mounted) visit(child); };
  for (const player of [state.players.player, state.players.ai]) {
    for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban', 'virtual']) {
      for (const card of player[zone]) visit(card);
    }
  }
  return result;
}

function take(state, playerId, id, occurrence = 0) {
  const player = state.players[playerId];
  for (const zone of ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']) {
    const index = player[zone].findIndex(card => card.id === id && occurrence-- === 0);
    if (index >= 0) return player[zone].splice(index, 1)[0];
  }
  throw new Error(`missing fixture card ${playerId}/${id}`);
}

function place(state, playerId, zone, card, slot = 1, faceDown = false) {
  if (zone === 'front' || zone === 'back') {
    card.boardSlot = slot;
    card.boardSlotController = playerId;
    card.boardSlotZone = zone;
    card.faceDown = faceDown;
  }
  state.players[playerId][zone].push(card);
  return card;
}

function frameAndRefs(state) {
  const indexed = buildRuntimeIdentityIndex(state);
  assert.equal(indexed.ok, true, JSON.stringify(indexed));
  const physical = new Map(allCards(state).map(card => [card.identity.instanceId, card]));
  const frame = {
    matchId: indexed.value.matchId,
    seatIds: [...state.runtimeContext.seatIds],
    cards: indexed.value.entries.map(entry => ({
      identity: { ...entry.identity }, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
      location: structuredClone(entry.location), faceDown: physical.get(entry.identity.instanceId).faceDown === true
    }))
  };
  const byId = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
  const rootTrackable = (card, viewer) => card.location.kind === 'board'
    || card.location.kind === 'zone' && card.location.zone === 'hand' && card.controllerSeat === viewer
    || card.location.kind === 'zone' && ['registry', 'trash', 'ban'].includes(card.location.zone) && !card.faceDown;
  const trackable = (card, viewer) => {
    if (card.location.kind !== 'mounted') return rootTrackable(card, viewer);
    let current = card;
    while (current.location.kind === 'mounted') {
      if (current.faceDown) return false;
      current = byId.get(current.location.host.instanceId);
      if (!current) return false;
    }
    return !current.faceDown && rootTrackable(current, viewer);
  };
  let next = 1;
  const newRefs = [];
  for (const card of frame.cards) for (const viewer of frame.seatIds) {
    if (trackable(card, viewer)) newRefs.push(`r:${String(next++).padStart(32, '0')}`);
  }
  const referenceState = createRuntimeReferenceState({ frame, newRefs });
  assert.equal(referenceState.ok, true, JSON.stringify(referenceState));
  return { frame, referenceState: referenceState.value };
}

function view(state, referenceState, viewerSeat = 'seat-a', revision = 4) {
  return projectRuntimeView(state, referenceState, { matchId: 'projection-match', viewerSeat, revision });
}

function snapshot(input, seen = new Map()) {
  if (input === null || (typeof input !== 'object' && typeof input !== 'function')) return input;
  if (seen.has(input)) return { shared: seen.get(input) };
  seen.set(input, seen.size);
  if (typeof input === 'function') return input;
  return { prototype: Object.getPrototypeOf(input), descriptors: Reflect.ownKeys(input).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return [key, Object.hasOwn(descriptor, 'value') ? { ...descriptor, value: snapshot(descriptor.value, seen) } : descriptor];
  }) };
}

function successful(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

function cardIn(viewValue, seatId, area, index = 0) {
  return viewValue.seats.find(seat => seat.seatId === seatId)[area].cards[index];
}

test('S02-PROJ-01: output uses the exact public envelope and seat shapes', () => {
  const state = game();
  place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  place(state, 'ai', 'hand', take(state, 'ai', 'STD-007'));
  const { referenceState } = frameAndRefs(state);
  const result = successful(view(state, referenceState));
  assert.deepEqual(Object.keys(result), ['matchId', 'revision', 'viewerSeat', 'activeSeat', 'turnNumber', 'seats']);
  assert.deepEqual(Object.keys(result.seats[0]), ['seatId', 'fortressStr', 'memory', 'deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban']);
  assert.deepEqual(Object.keys(result.seats[0].memory), ['current']);
  assert.deepEqual(Object.keys(result.seats[0].deck), ['count']);
  assert.deepEqual(Object.keys(result.seats[1].hand), ['count']);
  assert.deepEqual(Object.keys(result.seats[0].hand), ['count', 'cards']);
  assert.equal(result.seats[0].hand.count, 1);
  assert.equal(result.seats[1].hand.count, 1);
});

test('S02-PROJ-02: both viewers receive only their own hand definitions and opaque refs', () => {
  const state = game();
  const own = place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  place(state, 'ai', 'hand', take(state, 'ai', 'STD-007'));
  const { referenceState } = frameAndRefs(state);
  const a = successful(view(state, referenceState, 'seat-a'));
  const b = successful(view(state, referenceState, 'seat-b'));
  assert.deepEqual(Object.keys(a.seats[0].hand.cards[0]), ['cardRef', 'definition', 'currentCost']);
  assert.equal(a.seats[0].hand.cards[0].definition.id, own.id);
  assert.equal(a.seats[0].hand.cards[0].currentCost, executionCost(own, state, 'player'));
  assert.deepEqual(Object.keys(a.seats[1].hand), ['count']);
  assert.deepEqual(Object.keys(b.seats[0].hand), ['count']);
  assert.deepEqual(Object.keys(b.seats[1].hand.cards[0]), ['cardRef', 'definition', 'currentCost']);
  assert.equal(b.seats[1].hand.cards[0].definition.id, 'STD-007');
});

test('S02-PROJ-03: face-up board and zone cards use static definition allowlist and safe locations', () => {
  const state = game();
  const board = place(state, 'player', 'front', take(state, 'player', 'STD-022'), 2);
  const registry = place(state, 'ai', 'registry', take(state, 'ai', 'STD-007'));
  place(state, 'player', 'trash', take(state, 'player', 'STD-008'));
  place(state, 'ai', 'ban', take(state, 'ai', 'STD-100'));
  const { referenceState } = frameAndRefs(state);
  const result = successful(view(state, referenceState));
  const publicBoard = cardIn(result, 'seat-a', 'front');
  assert.equal(publicBoard.definition.id, board.id);
  assert.deepEqual(publicBoard.location, { kind: 'board', seatId: 'seat-a', zone: 'front', position: 2 });
  assert.deepEqual(Object.keys(publicBoard.definition), ['id', 'name', 'category', 'text', 'printedCategory', 'color', 'cost', 'atk', 'str', 'classes']);
  assert.deepEqual(Object.keys(publicBoard), ['cardRef', 'ownerSeat', 'controllerSeat', 'location', 'definition', 'faceDown', 'publicCounters', 'mounted']);
  assert.equal(cardIn(result, 'seat-b', 'registry').definition.id, registry.id);
  assert.deepEqual(cardIn(result, 'seat-b', 'registry').location, { kind: 'zone', seatId: 'seat-b', zone: 'registry' });
  assert.equal(result.seats[0].trash.count, 1);
  assert.equal(result.seats[0].trash.cards[0].definition.id, 'STD-008');
  assert.equal(result.seats[1].ban.cards[0].definition.id, 'STD-100');
});

test('S02-PROJ-04: face-down board hides owner/content while preserving controller location only', () => {
  const state = game();
  const hidden = take(state, 'player', 'STD-022');
  place(state, 'ai', 'back', hidden, 3, true);
  const { referenceState } = frameAndRefs(state);
  const result = successful(view(state, referenceState, 'seat-b'));
  const projection = cardIn(result, 'seat-b', 'back');
  assert.deepEqual(Object.keys(projection), ['cardRef', 'controllerSeat', 'area', 'slot', 'faceDown', 'placementOrder', 'publicCounters']);
  assert.match(projection.cardRef, /^r:[0-9a-f]{32}$/);
  assert.deepEqual({ ...projection, cardRef: '<opaque>' }, {
    cardRef: '<opaque>', controllerSeat: 'seat-b', area: 'back', slot: 3,
    faceDown: true, placementOrder: null, publicCounters: {}
  });
  assert.equal(Object.hasOwn(projection, 'ownerSeat'), false);
  assert.equal(Object.hasOwn(projection, 'definition'), false);
});

test('S02-PROJ-05: registry/trash/ban face-down cards count but do not expose card records', () => {
  const state = game();
  place(state, 'player', 'registry', Object.assign(take(state, 'player', 'STD-007'), { faceDown: true }));
  place(state, 'ai', 'trash', Object.assign(take(state, 'ai', 'STD-008'), { faceDown: true }));
  place(state, 'player', 'ban', Object.assign(take(state, 'player', 'STD-100'), { faceDown: true }));
  const { referenceState } = frameAndRefs(state);
  const result = successful(view(state, referenceState));
  assert.deepEqual(result.seats[0].registry, { count: 1, cards: [] });
  assert.deepEqual(result.seats[1].trash, { count: 1, cards: [] });
  assert.deepEqual(result.seats[0].ban, { count: 1, cards: [] });
});

test('S02-PROJ-06: mounted descendants require visible ancestors and expose no raw order', () => {
  const state = game();
  const host = place(state, 'player', 'front', take(state, 'player', 'STD-022'), 1);
  const visible = take(state, 'player', 'STD-007');
  visible.layerRole = 'mount'; host.mounted.push(visible);
  const hidden = take(state, 'player', 'STD-008');
  hidden.layerRole = 'layered'; hidden.faceDown = true; host.mounted.push(hidden);
  const visibleAfterHidden = take(state, 'player', 'STD-100');
  visibleAfterHidden.layerRole = 'layered'; host.mounted.push(visibleAfterHidden);
  const { referenceState } = frameAndRefs(state);
  const projected = cardIn(successful(view(state, referenceState)), 'seat-a', 'front');
  assert.equal(projected.mounted.length, 2);
  assert.equal(projected.mounted[0].definition.id, 'STD-007');
  assert.equal(projected.mounted[1].definition.id, 'STD-100');
  assert.deepEqual(projected.mounted[0].location, { kind: 'mounted', hostRef: projected.cardRef, role: 'mount' });
  assert.deepEqual(projected.mounted[1].location, { kind: 'mounted', hostRef: projected.cardRef, role: 'layered' });
  assert.equal(Object.hasOwn(projected.mounted[0].location, 'order'), false);
});

test('S02-PROJ-07: a missing visible reference is not issued or repaired', () => {
  const state = game();
  place(state, 'player', 'front', take(state, 'player', 'STD-022'), 1);
  const { referenceState } = frameAndRefs(state);
  referenceState.entries = referenceState.entries.filter(row => row.identity.instanceId !== state.players.player.front[0].identity.instanceId || row.viewerSeat !== 'seat-a');
  assert.deepEqual(view(state, referenceState), { ok: false, error: { code: 'PROJECTION_REFERENCE_NOT_READY' } });
  assert.equal(referenceState.entries.some(row => row.identity.instanceId === state.players.player.front[0].identity.instanceId && row.viewerSeat === 'seat-a'), false);
});

test('S02-PROJ-08: context shape and scope are distinguished before public projection', () => {
  const state = game();
  const { referenceState } = frameAndRefs(state);
  assert.deepEqual(projectRuntimeView(state, referenceState, { matchId: 'projection-match', viewerSeat: 'seat-a', revision: -1 }), { ok: false, error: { code: 'PROJECTION_INVALID_CONTEXT' } });
  assert.deepEqual(projectRuntimeView(state, referenceState, { matchId: 'projection-match', viewerSeat: 'outside', revision: 1 }), { ok: false, error: { code: 'PROJECTION_SCOPE_MISMATCH' } });
  assert.deepEqual(projectRuntimeView(state, { ...referenceState, matchId: 'other' }, { matchId: 'projection-match', viewerSeat: 'seat-a', revision: 1 }), { ok: false, error: { code: 'PROJECTION_SCOPE_MISMATCH' } });
  assert.deepEqual(projectRuntimeView(state, referenceState, { matchId: 'other', viewerSeat: 'seat-a', revision: 1 }), { ok: false, error: { code: 'PROJECTION_SCOPE_MISMATCH' } });
});

test('S02-PROJ-09: malformed engine descriptors and invalid public numbers are rejected', () => {
  const state = game();
  const { referenceState } = frameAndRefs(state);
  const badMemory = { ...state, players: { ...state.players, player: { ...state.players.player, memory: Number.NaN } } };
  assert.deepEqual(view(badMemory, referenceState), { ok: false, error: { code: 'PROJECTION_INVALID_STATE' } });
  const badDescriptor = { ...state, players: { ...state.players, player: { ...state.players.player, fortressStr: Infinity } } };
  assert.deepEqual(view(badDescriptor, referenceState), { ok: false, error: { code: 'PROJECTION_INVALID_STATE' } });
  const accessorPlayer = { ...state.players.player };
  const accessor = { ...state, players: { ...state.players, player: accessorPlayer } };
  Object.defineProperty(accessorPlayer, 'memory', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.deepEqual(view(accessor, referenceState), { ok: false, error: { code: 'PROJECTION_INVALID_STATE' } });
});

test('S02-PROJ-10: invalid own-hand computation fields fail without coercion', () => {
  const state = game();
  const handCard = place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  const { referenceState } = frameAndRefs(state);
  handCard.turnCostModifier = Number.NaN;
  assert.deepEqual(view(state, referenceState), { ok: false, error: { code: 'PROJECTION_INVALID_STATE' } });
});

test('S02-PROJ-11: face-down own trash still supplies only its name to current-cost calculation', () => {
  const state = game();
  const hand = place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  const sameNameTrash = take(state, 'player', 'STD-022');
  sameNameTrash.faceDown = true;
  place(state, 'player', 'trash', sameNameTrash);
  place(state, 'player', 'registry', take(state, 'player', 'STD-007'));
  const { referenceState } = frameAndRefs(state);
  const result = successful(view(state, referenceState, 'seat-a'));
  assert.equal(result.seats[0].hand.cards[0].currentCost, executionCost(hand, state, 'player'));
  assert.equal(result.seats[0].trash.count, 1);
  assert.deepEqual(result.seats[0].trash.cards, []);
});

test('S02-PROJ-12: opponent hand and hidden board contents are noninterfering', () => {
  const state = game();
  place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  const opponentHand = place(state, 'ai', 'hand', take(state, 'ai', 'STD-007'));
  const hidden = place(state, 'ai', 'front', take(state, 'ai', 'STD-008'), 2, true);
  const refs = frameAndRefs(state).referenceState;
  const before = successful(view(state, refs, 'seat-a'));
  opponentHand.name = 'SECRET_HAND_CANARY';
  opponentHand.cost = 999999;
  hidden.name = 'SECRET_BOARD_CANARY';
  hidden.cost = 999999;
  hidden.text = 'SECRET_TEXT_CANARY';
  const after = successful(view(state, refs, 'seat-a'));
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(after).includes('SECRET_'), false);
});

test('S02-PROJ-13: nested output is independent and projection preserves every input', () => {
  const state = game();
  place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  place(state, 'player', 'front', take(state, 'player', 'STD-007'), 1);
  const { referenceState } = frameAndRefs(state);
  const beforeState = snapshot(state); const beforeReferences = snapshot(referenceState);
  const first = successful(view(state, referenceState));
  assert.deepEqual(snapshot(state), beforeState);
  assert.deepEqual(snapshot(referenceState), beforeReferences);
  first.seats[0].hand.cards[0].definition.classes.push('mutated');
  first.seats[0].front.cards[0].mounted.push({ broken: true });
  first.seats[0].hand.cards.push({ broken: true });
  const second = successful(view(state, referenceState));
  assert.equal(second.seats[0].hand.cards.length, 1);
  assert.equal(second.seats[0].hand.cards[0].definition.classes.includes('mutated'), false);
  assert.deepEqual(second.seats[0].front.cards[0].mounted, []);
});

test('S02-PROJ-14: identity-state match mismatch is invalid state, not projection scope', () => {
  const state = game();
  const { referenceState } = frameAndRefs(state);
  const malformed = {
    ...state,
    runtimeContext: {
      ...state.runtimeContext,
      identityState: { ...state.runtimeContext.identityState, matchId: 'different-ledger-match' }
    }
  };
  assert.deepEqual(view(malformed, referenceState), { ok: false, error: { code: 'PROJECTION_INVALID_STATE' } });
});

test('S02-PROJ-15: frozen inputs and full session-to-view integration remain read-only', () => {
  const state = game();
  place(state, 'player', 'hand', take(state, 'player', 'STD-022'));
  place(state, 'ai', 'front', take(state, 'ai', 'STD-007'), 2);
  const { referenceState } = frameAndRefs(state);
  const freeze = value => {
    if (value && typeof value === 'object') {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (Object.hasOwn(descriptor, 'value')) freeze(descriptor.value);
      Object.freeze(value);
    }
    return value;
  };
  const result = successful(projectRuntimeView(freeze(state), freeze(referenceState), Object.freeze({ matchId: 'projection-match', viewerSeat: 'seat-a', revision: 8 })));
  assert.equal(result.revision, 8);
  assert.equal(result.seats[1].front.cards[0].definition.id, 'STD-007');
});
