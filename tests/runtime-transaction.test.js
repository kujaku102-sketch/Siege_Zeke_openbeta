import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeReferenceFrame } from '../src/game/runtime/reference-frame.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { createCommandJournal } from '../src/game/runtime/command-record.js';
import { submitRuntimeCommand } from '../src/game/runtime/transaction.js';
import { createRuntimeCard } from '../src/game/runtime/factory.js';
import { activateCardEffect, getActivatableEffects, installCard, playCard } from '../src/game/engine.js';
import { placeCardInBoardSlot } from '../src/game/board-slots.js';
import { buildRequiredInput } from '../src/game/runtime/required-input.js';

const token = serial => `r:${serial.toString(16).padStart(32, '0')}`;
const command = (overrides = {}) => ({
  contractVersion: 1, matchId: 'transaction-match', commandId: 'command-1', actorSeat: 'seat-a', expectedRevision: 0,
  action: { type: 'sandboxAddCard', definitionId: 'STD-001', targetSeat: 'seat-a' }, ...overrides
});
const context = (actorSeat = 'seat-a') => ({ matchId: 'transaction-match', actorSeat });

function trackableCount(frame) {
  const entries = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
  const rootTrackable = (card, viewer) => card.location.kind === 'board'
    || card.location.kind === 'zone' && card.location.zone === 'hand' && card.controllerSeat === viewer
    || card.location.kind === 'zone' && ['registry', 'trash', 'ban'].includes(card.location.zone) && !card.faceDown;
  const trackable = (card, viewer) => {
    if (card.location.kind !== 'mounted') return rootTrackable(card, viewer);
    let current = card;
    while (current.location.kind === 'mounted') {
      if (current.faceDown) return false;
      current = entries.get(current.location.host.instanceId);
      if (!current) return false;
    }
    return !current.faceDown && rootTrackable(current, viewer);
  };
  return frame.cards.reduce((count, card) => count + frame.seatIds.filter(viewer => trackable(card, viewer)).length, 0);
}

function completeAuthority(sessionValue) {
  const frame = buildRuntimeReferenceFrame(sessionValue.engineState);
  assert.equal(frame.ok, true, JSON.stringify(frame));
  const referenceState = createRuntimeReferenceState({
    frame: frame.value,
    newRefs: Array.from({ length: trackableCount(frame.value) }, (_, index) => token(index + 1))
  });
  assert.equal(referenceState.ok, true, JSON.stringify(referenceState));
  const journal = createCommandJournal({ matchId: 'transaction-match', seatIds: ['seat-a', 'seat-b'] });
  assert.equal(journal.ok, true);
  return { ...sessionValue, referenceState: referenceState.value, journal: journal.value };
}

function authority({ mode = 'sandbox', playerUserId = 'doors_zx', playerDeckRecipe = [], aiDeckRecipe = [] } = {}) {
  const session = createRuntimeSession({
    matchId: 'transaction-match', seatIds: ['seat-a', 'seat-b'], seed: 23, ruleVersion: 'rules-1', cardVersion: 'cards-1',
    gameOptions: {
      mode, tutorialId: 'basics', playerDeckId: 'red', aiDeckId: 'yellow', playerDeckRecipe, aiDeckRecipe: [],
      playerUserId, aiUserId: 'doors_zx', sandboxDeckSetup: false, aiDeckRecipe
    }
  });
  assert.equal(session.ok, true, JSON.stringify(session));
  return completeAuthority(session.value);
}

function restAuthority() {
  const source = authority({ mode: 'ai' });
  const engine = source.engineState;
  engine.players.player.memory = 20;
  const symbol = createRuntimeCard(engine.runtimeContext, 'STD-129', 'player');
  engine.players.player.hand.push(symbol);
  assert.equal(installCard(engine, 'player', symbol.uid), true);
  engine.players.player.registryActionUsed = false;
  const guard = createRuntimeCard(engine.runtimeContext, 'STD-129', 'player');
  engine.players.player.hand.push(guard);
  assert.equal(playCard(engine, 'player', guard.uid, { zone: 'front', requestedSlot: 1 }), true);
  engine.securityRestWindow = 'player';
  const rebuilt = completeAuthority({
    metadata: source.metadata, revision: source.revision, engineState: engine
  });
  const cardRef = rebuilt.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === guard.identity.instanceId)?.cardRef;
  assert.equal(typeof cardRef, 'string');
  return { authority: rebuilt, guard, cardRef };
}

function mulliganAuthority() {
  const source = authority({ mode: 'ai', playerUserId: 'bigboss', playerDeckRecipe: [['STD-001', 10]] });
  source.engineState.active = 'player';
  source.engineState.turnNumber = 1;
  assert.equal(source.engineState.players.player.hand.length, 5);
  return completeAuthority({ metadata: source.metadata, revision: source.revision, engineState: source.engineState });
}

function recoverAuthority() {
  const source = authority({ mode: 'ai' });
  const engine = source.engineState;
  const player = engine.players.player;
  const ai = engine.players.ai;
  player.memory = 20;
  const symbol = createRuntimeCard(engine.runtimeContext, 'STD-214', 'player');
  player.hand.push(symbol);
  assert.equal(installCard(engine, 'player', symbol.uid), true);
  player.registryActionUsed = false;
  const holy = createRuntimeCard(engine.runtimeContext, 'STD-217', 'player');
  const merchant = createRuntimeCard(engine.runtimeContext, 'STD-218', 'player');
  player.hand.push(holy, merchant);
  assert.equal(playCard(engine, 'player', holy.uid, { zone: 'front', requestedSlot: 1, free: true }), true);
  assert.equal(playCard(engine, 'player', merchant.uid, { zone: 'front', requestedSlot: 2, free: true }), true);
  const recoverable = createRuntimeCard(engine.runtimeContext, 'STD-020', 'player');
  player.hand.push(recoverable);
  assert.equal(installCard(engine, 'player', recoverable.uid), true);
  player.registryActionUsed = false;
  player.memory = 0;
  const rebuilt = completeAuthority({ metadata: source.metadata, revision: source.revision, engineState: engine });
  const cardRef = rebuilt.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === recoverable.identity.instanceId)?.cardRef;
  const opponentRef = rebuilt.referenceState.entries.find(entry => entry.viewerSeat === 'seat-b'
    && entry.identity.instanceId === recoverable.identity.instanceId)?.cardRef;
  assert.equal(typeof cardRef, 'string');
  assert.equal(typeof opponentRef, 'string');
  return { authority: rebuilt, recoverable, cardRef, opponentRef, fortressStr: ai.fortressStr };
}

function installAuthority({ cardId = 'STD-001', observer = false } = {}) {
  const source = authority({ mode: 'ai' });
  const engine = source.engineState;
  if (observer) {
    const baris = createRuntimeCard(engine.runtimeContext, 'STD-226', 'ai');
    engine.players.ai.hand.push(baris);
    assert.equal(playCard(engine, 'ai', baris.uid, {
      zone: 'front', requestedSlot: 1, force: true, free: true, ignoreColor: true, allowOffTurn: true
    }), true);
  }
  const card = createRuntimeCard(engine.runtimeContext, cardId, 'player');
  engine.players.player.hand.push(card);
  const rebuilt = completeAuthority({ metadata: source.metadata, revision: source.revision, engineState: engine });
  const cardRef = rebuilt.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === card.identity.instanceId)?.cardRef;
  assert.equal(typeof cardRef, 'string');
  assert.equal(rebuilt.referenceState.entries.some(entry => entry.viewerSeat === 'seat-b'
    && entry.identity.instanceId === card.identity.instanceId), false);
  return { authority: rebuilt, card, cardRef };
}

function serializableEngine(engineState) {
  return structuredClone({ ...engineState, rng: null, history: [] });
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

test('S03-TRX-01: sandboxAddCard commits one isolated authority revision with identity and reference transition', () => {
  const source = authority();
  const beforeEngine = serializableEngine(source.engineState);
  const beforeHand = source.engineState.players.player.hand.length;
  const beforeDraws = source.engineState.runtimeContext.rngState.draws;
  const result = submitRuntimeCommand(source, context(), command());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.deepEqual(result.value.receipt, {
    matchId: 'transaction-match', commandId: 'command-1', status: 'accepted', revision: 1, reasonCode: 'ACCEPTED'
  });
  const next = result.value.authority;
  assert.equal(next.revision, 1);
  assert.equal(next.engineState.players.player.hand.length, beforeHand + 1);
  const added = next.engineState.players.player.hand.at(-1);
  assert.equal(added.id, 'STD-001');
  assert.equal(added.uid, `rt:${added.identity.instanceId}`);
  assert.ok(next.engineState.runtimeContext.uidAliases.some(alias => alias.uid === added.uid));
  assert.ok(next.referenceState.entries.some(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === added.identity.instanceId));
  assert.equal(next.referenceState.entries.some(entry => entry.viewerSeat === 'seat-b'
    && entry.identity.instanceId === added.identity.instanceId), false);
  assert.equal(next.engineState.runtimeContext.rngState.draws, beforeDraws);
  const previousRefs = new Set(source.referenceState.issuedRefs);
  const addedRefs = next.referenceState.issuedRefs.filter(cardRef => !previousRefs.has(cardRef));
  assert.equal(addedRefs.length, 1);
  assert.match(addedRefs[0], /^r:[0-9a-f]{32}$/);
  assert.equal(next.journal.entries.length, 1);
  assert.deepEqual(serializableEngine(source.engineState), beforeEngine);
  assert.equal(source.revision, 0);
  assert.equal(source.journal.entries.length, 0);
  assert.notEqual(next.metadata, source.metadata);
  assert.notEqual(next.engineState, source.engineState);
  assert.notEqual(next.referenceState, source.referenceState);
  assert.notEqual(next.journal, source.journal);
});

test('S03-TRX-02: exact retry returns the stored receipt without a second apply, revision or journal entry', () => {
  const first = submitRuntimeCommand(authority(), context(), command());
  assert.equal(first.ok, true);
  const accepted = first.value.authority;
  const hand = accepted.engineState.players.player.hand.length;
  const retried = submitRuntimeCommand(accepted, context(), command());
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(retried.value.kind, 'retry');
  assert.deepEqual(retried.value.receipt, first.value.receipt);
  assert.equal(retried.value.authority, accepted);
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.engineState.players.player.hand.length, hand);
  assert.equal(accepted.journal.entries.length, 1);
});

test('S03-TRX-03: endTurn now commits through the same isolated authority boundary', () => {
  const source = authority();
  const before = serializableEngine(source.engineState);
  const result = submitRuntimeCommand(source, context(), command({ action: { type: 'endTurn' } }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.equal(result.value.receipt.reasonCode, 'ACCEPTED');
  assert.equal(result.value.authority.revision, 1);
  assert.notEqual(result.value.authority.engineState, source.engineState);
  assert.equal(result.value.authority.journal.entries.length, 1);
  assert.deepEqual(serializableEngine(source.engineState), before);
});

test('S03-TRX-04: stale and unavailable commands persist public rejection while malformed and unauthorized input do not', () => {
  const staleSource = authority();
  const stale = submitRuntimeCommand(staleSource, context(), command({ expectedRevision: 1 }));
  assert.equal(stale.ok, true);
  assert.equal(stale.value.receipt.reasonCode, 'STALE_REVISION');
  assert.equal(stale.value.authority.journal.entries.length, 1);
  assert.equal(staleSource.journal.entries.length, 0);

  const unavailableSource = authority({ mode: 'ai' });
  const unavailable = submitRuntimeCommand(unavailableSource, context(), command());
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
  assert.equal(unavailable.value.authority.journal.entries.length, 1);

  const malformedSource = authority();
  const malformed = submitRuntimeCommand(malformedSource, context(), { ...command(), extra: true });
  assert.deepEqual(malformed, { ok: false, error: { code: 'INVALID_COMMAND' } });
  assert.equal(malformedSource.journal.entries.length, 0);
  const unauthorized = submitRuntimeCommand(malformedSource, context('seat-b'), command());
  assert.deepEqual(unauthorized, { ok: false, error: { code: 'NOT_AUTHORIZED' } });
  assert.equal(malformedSource.journal.entries.length, 0);
});

test('S03-TRX-05: frozen authority is accepted without input mutation', () => {
  const source = freeze(authority());
  const result = submitRuntimeCommand(source, freeze(context()), freeze(command()));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.equal(source.revision, 0);
  assert.equal(source.journal.entries.length, 0);
});

test('S03-TRX-06: invalid reference baseline and command collision never produce accepted state', () => {
  const broken = authority();
  broken.referenceState.entries.pop();
  const before = serializableEngine(broken.engineState);
  const invalid = submitRuntimeCommand(broken, context(), command());
  assert.deepEqual(invalid, { ok: false, error: { code: 'INVALID_AUTHORITY' } });
  assert.deepEqual(serializableEngine(broken.engineState), before);
  assert.equal(broken.revision, 0);
  assert.equal(broken.journal.entries.length, 0);

  const first = submitRuntimeCommand(authority(), context(), command());
  assert.equal(first.ok, true);
  const collision = submitRuntimeCommand(first.value.authority, context(), command({
    action: { type: 'sandboxAddCard', definitionId: 'STD-002', targetSeat: 'seat-a' }
  }));
  assert.deepEqual(collision, { ok: false, error: { code: 'COMMAND_ID_COLLISION' } });
  assert.equal(first.value.authority.journal.entries.length, 1);
});

test('S03-TRX-07: restSecurity commits sleep once and exact retry never repeats the action', () => {
  const fixture = restAuthority();
  const beforeRefs = structuredClone(fixture.authority.referenceState);
  const restCommand = command({ action: { type: 'restSecurity', cardRef: fixture.cardRef } });
  const result = submitRuntimeCommand(fixture.authority, context(), restCommand);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.equal(result.value.authority.revision, 1);
  const nextGuard = result.value.authority.engineState.players.player.front.find(card => card.identity.instanceId === fixture.guard.identity.instanceId);
  assert.equal(nextGuard.sleep, true);
  assert.equal(fixture.guard.sleep, false);
  assert.deepEqual(result.value.authority.referenceState, beforeRefs);
  const logLength = result.value.authority.engineState.log.length;
  const retried = submitRuntimeCommand(result.value.authority, context(), restCommand);
  assert.equal(retried.ok, true);
  assert.equal(retried.value.kind, 'retry');
  assert.equal(retried.value.authority.engineState.log.length, logLength);
});

test('S03-TRX-08: openingMulligan advances only copied rule RNG and commits hidden reference transition once', () => {
  const source = mulliganAuthority();
  const beforeRng = { ...source.engineState.runtimeContext.rngState };
  const beforeHand = source.engineState.players.player.hand.map(card => card.identity.instanceId);
  const mulligan = command({ action: { type: 'openingMulligan' } });
  const result = submitRuntimeCommand(source, context(), mulligan);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  const next = result.value.authority;
  assert.equal(next.revision, 1);
  assert.equal(next.engineState.players.player.hand.length, 5);
  assert.equal(next.engineState.players.player.mulligansUsed, 1);
  assert.ok(next.engineState.runtimeContext.rngState.draws > beforeRng.draws);
  assert.deepEqual(source.engineState.runtimeContext.rngState, beforeRng);
  assert.deepEqual(source.engineState.players.player.hand.map(card => card.identity.instanceId), beforeHand);
  const frame = buildRuntimeReferenceFrame(next.engineState);
  assert.equal(frame.ok, true);
  const visible = new Set(frame.value.cards.filter(card => card.location.kind === 'zone'
    && card.location.zone === 'hand' && card.controllerSeat === 'seat-a').map(card => card.identity.instanceId));
  assert.deepEqual(new Set(next.referenceState.entries.filter(entry => entry.viewerSeat === 'seat-a'
    && visible.has(entry.identity.instanceId)).map(entry => entry.identity.instanceId)), visible);
  const draws = next.engineState.runtimeContext.rngState.draws;
  const retried = submitRuntimeCommand(next, context(), mulligan);
  assert.equal(retried.ok, true);
  assert.equal(retried.value.kind, 'retry');
  assert.equal(next.engineState.runtimeContext.rngState.draws, draws);
  assert.equal(next.engineState.players.player.mulligansUsed, 1);
});

test('S03-TRX-09: recoverRegistry drains leave triggers and commits one public-to-hidden reference transition', () => {
  const fixture = recoverAuthority();
  const source = fixture.authority;
  const beforeEvents = source.engineState.events.length;
  const beforeLog = source.engineState.log.length;
  const beforeIssued = new Set(source.referenceState.issuedRefs);
  const recover = command({ action: { type: 'recoverRegistry', cardRef: fixture.cardRef } });
  const result = submitRuntimeCommand(source, context(), recover);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  const next = result.value.authority;
  const player = next.engineState.players.player;
  assert.equal(next.revision, 1);
  assert.equal(player.registry.some(card => card.identity.instanceId === fixture.recoverable.identity.instanceId), false);
  assert.equal(player.hand.some(card => card.identity.instanceId === fixture.recoverable.identity.instanceId), true);
  assert.equal(next.engineState.players.ai.fortressStr, fixture.fortressStr - 1);
  assert.equal(player.memory, 1);
  assert.equal(next.engineState.effectResolution, null);
  assert.equal(next.engineState.pending, null);
  assert.equal(next.engineState.prompt, null);
  assert.deepEqual(next.engineState.triggerQueue, []);
  assert.deepEqual(next.engineState.independentEffects, []);
  assert.ok(next.engineState.events.slice(beforeEvents).some(event => event.type === 'registry_left'
    && event.cardUid === fixture.recoverable.uid && event.reason === 'recover'));
  assert.equal(next.referenceState.entries.some(entry => entry.cardRef === fixture.cardRef), false);
  assert.equal(next.referenceState.entries.some(entry => entry.cardRef === fixture.opponentRef), false);
  const ownHandEntry = next.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === fixture.recoverable.identity.instanceId);
  assert.equal(typeof ownHandEntry?.cardRef, 'string');
  assert.equal(beforeIssued.has(ownHandEntry.cardRef), false);
  assert.equal(next.referenceState.entries.some(entry => entry.viewerSeat === 'seat-b'
    && entry.identity.instanceId === fixture.recoverable.identity.instanceId), false);
  assert.equal(source.engineState.players.ai.fortressStr, fixture.fortressStr);
  assert.equal(source.engineState.players.player.memory, 0);
  assert.equal(source.engineState.players.player.registry.some(card => card.identity.instanceId === fixture.recoverable.identity.instanceId), true);

  const eventLength = next.engineState.events.length;
  const retried = submitRuntimeCommand(next, context(), recover);
  assert.equal(retried.ok, true);
  assert.equal(retried.value.kind, 'retry');
  assert.equal(retried.value.authority, next);
  assert.equal(next.revision, 1);
  assert.equal(next.engineState.players.ai.fortressStr, fixture.fortressStr - 1);
  assert.equal(next.engineState.players.player.memory, 1);
  assert.equal(next.engineState.events.length, eventLength);
  assert.equal(next.engineState.log.length >= beforeLog, true);
  assert.equal(next.journal.entries.length, 1);
});

test('S03-TRX-10: ordinary install completes and publishes one opponent reference without rotating the owner handle', () => {
  const fixture = installAuthority();
  const source = fixture.authority;
  const beforeIssued = new Set(source.referenceState.issuedRefs);
  const install = command({ action: { type: 'install', cardRef: fixture.cardRef } });
  const result = submitRuntimeCommand(source, context(), install);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  const next = result.value.authority;
  assert.equal(next.revision, 1);
  assert.equal(next.engineState.players.player.hand.some(card => card.identity.instanceId === fixture.card.identity.instanceId), false);
  assert.equal(next.engineState.players.player.registry.some(card => card.identity.instanceId === fixture.card.identity.instanceId), true);
  assert.equal(next.engineState.players.player.registryActionUsed, true);
  assert.equal(next.engineState.pending, null);
  assert.equal(next.engineState.prompt, null);
  const ownerEntry = next.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === fixture.card.identity.instanceId);
  const opponentEntry = next.referenceState.entries.find(entry => entry.viewerSeat === 'seat-b'
    && entry.identity.instanceId === fixture.card.identity.instanceId);
  assert.equal(ownerEntry.cardRef, fixture.cardRef);
  assert.equal(typeof opponentEntry?.cardRef, 'string');
  assert.equal(beforeIssued.has(opponentEntry.cardRef), false);
  assert.equal(source.engineState.players.player.hand.some(card => card.identity.instanceId === fixture.card.identity.instanceId), true);
  assert.equal(source.engineState.players.player.registry.length, 0);
});

test('S03-TRX-11: STD-224 install commits its plugin-number prompt and exact retry never recreates it', () => {
  const fixture = installAuthority({ cardId: 'STD-224' });
  const install = command({ action: { type: 'install', cardRef: fixture.cardRef } });
  const result = submitRuntimeCommand(fixture.authority, context(), install);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  const next = result.value.authority;
  assert.equal(next.engineState.players.player.registry.some(card => card.identity.instanceId === fixture.card.identity.instanceId), true);
  assert.equal(next.engineState.players.player.registryActionUsed, true);
  assert.equal(next.engineState.pending, null);
  assert.equal(next.engineState.prompt?.type, 'plugin-number');
  assert.equal(next.engineState.prompt?.playerId, 'player');
  assert.equal(next.engineState.prompt?.pluginUid, fixture.card.uid);
  const prompt = structuredClone(next.engineState.prompt);
  const events = next.engineState.events.length;
  const log = next.engineState.log.length;
  const retried = submitRuntimeCommand(next, context(), install);
  assert.equal(retried.ok, true);
  assert.equal(retried.value.kind, 'retry');
  assert.equal(retried.value.authority, next);
  assert.deepEqual(next.engineState.prompt, prompt);
  assert.equal(next.engineState.events.length, events);
  assert.equal(next.engineState.log.length, log);
  assert.equal(next.revision, 1);
  assert.equal(next.journal.entries.length, 1);
});

test('S03-TRX-12: opponent STD-226 install trigger commits an actor-bound pending selection', () => {
  const fixture = installAuthority({ observer: true });
  const install = command({ action: { type: 'install', cardRef: fixture.cardRef } });
  const result = submitRuntimeCommand(fixture.authority, context(), install);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  const next = result.value.authority;
  assert.equal(next.engineState.players.player.registry.some(card => card.identity.instanceId === fixture.card.identity.instanceId), true);
  assert.equal(next.engineState.prompt, null);
  assert.equal(next.engineState.pending?.type, 'selection');
  assert.equal(next.engineState.pending?.request?.continuation?.type, 'std226-compress');
  assert.equal(next.engineState.pending?.resolutionMeta?.actorId, 'ai');
  assert.equal(next.engineState.pending?.validTargets.includes(fixture.card.uid), true);
  assert.equal(next.engineState.projectionSlotRevision.pending, 1);
  assert.equal(next.engineState.selectionQueue.length, 0);
});

test('S03-TRX-13: plugin install may commit its prompt beside the opponent pending selection', () => {
  const fixture = installAuthority({ cardId: 'STD-224', observer: true });
  const result = submitRuntimeCommand(fixture.authority, context(), command({
    action: { type: 'install', cardRef: fixture.cardRef }
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  const engine = result.value.authority.engineState;
  assert.equal(engine.pending?.request?.continuation?.type, 'std226-compress');
  assert.equal(engine.pending?.resolutionMeta?.actorId, 'ai');
  assert.equal(engine.prompt?.type, 'plugin-number');
  assert.equal(engine.prompt?.playerId, 'player');
  assert.equal(engine.prompt?.pluginUid, fixture.card.uid);
  assert.equal(result.value.authority.revision, 1);
  assert.equal(result.value.authority.journal.entries.length, 1);
});

function refFor(runtimeAuthority, card, viewerSeat = 'seat-a') {
  return runtimeAuthority.referenceState.entries.find(entry => entry.viewerSeat === viewerSeat
    && entry.identity.instanceId === card.identity.instanceId)?.cardRef;
}

function rebuilt(source) {
  return completeAuthority({ metadata: source.metadata, revision: source.revision, engineState: source.engineState });
}

test('S03-TRX-14: remaining prepared actions share one atomic transaction boundary', () => {
  const cases = [];

  {
    const source = authority({ mode: 'ai' });
    source.engineState.players.player.memory = 20;
    const card = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-027', 'player'), { color: null });
    source.engineState.players.player.hand.push(card);
    const ready = rebuilt(source);
    cases.push({ name: 'executeCard', authority: ready,
      command: command({ commandId: 'execute', action: { type: 'executeCard', cardRef: refFor(ready, card), destination: { zone: 'front', slot: 1 } } }),
      verify: next => assert.equal(next.engineState.players.player.front.some(item => item.identity.instanceId === card.identity.instanceId), true) });
  }
  {
    const source = authority({ mode: 'ai' });
    source.engineState.players.player.memory = 20;
    const script = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'SZTB-090', 'player'), {
      faceDown: true, color: null, activationCost: 0
    });
    assert.equal(placeCardInBoardSlot(source.engineState.players.player.back, script,
      { controllerId: 'player', zoneName: 'back', limit: 5, requestedSlot: 1 }), true);
    const ready = rebuilt(source);
    cases.push({ name: 'activateScript', authority: ready,
      command: command({ commandId: 'script', action: { type: 'activateScript', cardRef: refFor(ready, script) } }),
      verify: next => assert.equal(next.engineState.players.player.back.find(item => item.identity.instanceId === script.identity.instanceId)?.faceDown, false) });
  }
  {
    const source = authority({ mode: 'ai' });
    source.engineState.players.player.memory = 30;
    const card = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-232', 'player'), { color: null });
    const first = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-020', 'player'), { faceDown: false });
    const second = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-021', 'player'), { faceDown: false });
    source.engineState.players.player.hand.push(card);
    assert.equal(placeCardInBoardSlot(source.engineState.players.player.front, first,
      { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
    source.engineState.players.player.registry.push(second);
    const ready = rebuilt(source);
    cases.push({ name: 'executeLayered', authority: ready,
      command: command({ commandId: 'layered', action: { type: 'executeLayered', cardRef: refFor(ready, card),
        materialRefs: [refFor(ready, first), refFor(ready, second)], destination: { zone: 'back', slot: 5 } } }),
      verify: next => assert.equal(next.engineState.players.player.back.find(item => item.identity.instanceId === card.identity.instanceId)?.mounted.length, 2) });
  }
  {
    const source = authority({ mode: 'ai' });
    source.engineState.players.player.memory = 20;
    const card = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-027', 'player'), { color: null });
    assert.equal(placeCardInBoardSlot(source.engineState.players.player.front, card,
      { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
    const ready = rebuilt(source);
    cases.push({ name: 'redeploy', authority: ready,
      command: command({ commandId: 'redeploy', action: { type: 'redeploy', cardRef: refFor(ready, card), destination: { zone: 'back', slot: 5 } } }),
      verify: next => assert.equal(next.engineState.players.player.back.some(item => item.identity.instanceId === card.identity.instanceId), true) });
  }
  {
    const source = authority({ mode: 'ai' });
    const attacker = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-020', 'player'), { summoningSick: false, sleep: false });
    const target = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-020', 'ai'), { summoningSick: false, sleep: true });
    assert.equal(placeCardInBoardSlot(source.engineState.players.player.front, attacker,
      { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
    assert.equal(placeCardInBoardSlot(source.engineState.players.ai.front, target,
      { controllerId: 'ai', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
    const ready = rebuilt(source);
    cases.push({ name: 'attack', authority: ready,
      command: command({ commandId: 'attack', action: { type: 'attack', attackerRef: refFor(ready, attacker), target: { kind: 'card', cardRef: refFor(ready, target) } } }),
      verify: next => assert.equal(next.engineState.players.ai.trash.some(item => item.identity.instanceId === target.identity.instanceId), true) });
  }
  {
    const ready = authority({ mode: 'ai' });
    cases.push({ name: 'activateAbility', authority: ready,
      command: command({ commandId: 'turbo', action: { type: 'activateAbility', ability: { kind: 'user', key: 'turbo' } } }),
      verify: next => assert.equal(next.engineState.players.player.turboActive, true) });
  }

  for (const entry of cases) {
    const result = submitRuntimeCommand(entry.authority, context(), entry.command);
    assert.equal(result.ok, true, `${entry.name}: ${JSON.stringify(result)}`);
    assert.equal(result.value.kind, 'accepted', entry.name);
    assert.equal(result.value.authority.revision, 1, entry.name);
    assert.equal(result.value.authority.journal.entries.length, 1, entry.name);
    assert.equal(result.value.publicResult.receipt.progress,
      result.value.authority.engineState.pending || result.value.authority.engineState.prompt ? 'awaitingInput' : 'ready');
    assert.equal(result.value.publicResult.events.length, 1, entry.name);
    entry.verify(result.value.authority);
    const retry = submitRuntimeCommand(result.value.authority, context(), entry.command);
    assert.equal(retry.ok, true, entry.name);
    assert.equal(retry.value.kind, 'retry', entry.name);
    assert.deepEqual(retry.value.publicResult.receipt.eventIds, result.value.publicResult.receipt.eventIds, entry.name);
    assert.deepEqual(retry.value.publicResult.events, [], entry.name);
  }
});

test('S03-TRX-15: endTurn distinguishes an accepted Security/input window from a refusal', () => {
  const source = authority({ mode: 'ai' });
  const security = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-129', 'player'), {
    faceDown: false, sleep: false, summoningSick: false
  });
  assert.equal(placeCardInBoardSlot(source.engineState.players.player.front, security,
    { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  const ready = rebuilt(source);
  const result = submitRuntimeCommand(ready, context(), command({ commandId: 'end-security', action: { type: 'endTurn' } }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.equal(result.value.authority.engineState.securityRestWindow, 'player');
  assert.equal(result.value.publicResult.receipt.progress, 'awaitingInput');
  assert.equal(ready.engineState.securityRestWindow, undefined);
});

test('S04-TRX-01: plugin prompt is projected and answered through one deterministic choice transaction', () => {
  const fixture = installAuthority({ cardId: 'STD-224' });
  const installed = submitRuntimeCommand(fixture.authority, context(), command({
    commandId: 'install-plugin-choice', action: { type: 'install', cardRef: fixture.cardRef }
  }));
  assert.equal(installed.ok, true, JSON.stringify(installed));
  const required = installed.value.publicResult.requiredInput;
  assert.deepEqual({ choiceId: required.choiceId, presentationKey: required.presentationKey, canAnswer: required.canAnswer }, {
    choiceId: 'choice:1:plugin-number', presentationKey: 'plugin-number', canAnswer: true
  });
  assert.equal(required.options.length, 8);
  assert.equal(required.options[5].label, '5');
  const answer = command({
    commandId: 'answer-plugin-choice', expectedRevision: 1,
    action: { type: 'answerChoice', choiceId: required.choiceId, optionIds: [required.options[5].optionId], allocation: [] }
  });
  const answered = submitRuntimeCommand(installed.value.authority, context(), answer);
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.value.kind, 'accepted');
  assert.equal(answered.value.authority.revision, 2);
  assert.equal(answered.value.authority.engineState.prompt, null);
  assert.equal(answered.value.authority.engineState.players.player.registry.find(card => card.id === 'STD-224')?.pluginValue, 5);
  assert.equal(answered.value.publicResult.requiredInput, null);
  const retry = submitRuntimeCommand(answered.value.authority, context(), answer);
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.value.kind, 'retry');
  assert.equal(retry.value.authority.revision, 2);
});

test('S04-TRX-02: wrong seat and stale choice identity cannot consume an opponent selection', () => {
  const fixture = installAuthority({ observer: true });
  const installed = submitRuntimeCommand(fixture.authority, context(), command({
    commandId: 'install-observed', action: { type: 'install', cardRef: fixture.cardRef }
  }));
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.deepEqual(installed.value.publicResult.requiredInput, {
    kind: 'waiting', actorSeat: 'seat-b', canAnswer: false,
    options: [], constraints: { kind: 'waiting' }
  });
  const opponentInput = buildRequiredInput(installed.value.authority, 'seat-b');
  assert.equal(opponentInput.ok, true, JSON.stringify(opponentInput));
  const stale = command({
    commandId: 'stale-choice', actorSeat: 'seat-b', expectedRevision: 1,
    action: { type: 'answerChoice', choiceId: 'choice:0:selection', optionIds: ['option:1'], allocation: [] }
  });
  const rejected = submitRuntimeCommand(installed.value.authority, context('seat-b'), stale);
  assert.equal(rejected.ok, true, JSON.stringify(rejected));
  assert.equal(rejected.value.kind, 'rejected');
  assert.equal(rejected.value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
  assert.equal(rejected.value.authority.engineState.pending?.type, 'selection');
  const answer = command({
    commandId: 'answer-opponent-choice', actorSeat: 'seat-b', expectedRevision: 1,
    action: {
      type: 'answerChoice', choiceId: opponentInput.value.choiceId,
      optionIds: [opponentInput.value.options[0].optionId], allocation: []
    }
  });
  const answered = submitRuntimeCommand(installed.value.authority, context('seat-b'), answer);
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.value.kind, 'accepted');
  assert.equal(answered.value.authority.revision, 2);
  assert.notEqual(answered.value.authority.engineState.pending?.request?.continuation?.type, 'std226-compress');
});

test('S04-TRX-03: optional Security input can be declined to complete the turn handoff', () => {
  const source = authority({ mode: 'ai' });
  const security = Object.assign(createRuntimeCard(source.engineState.runtimeContext, 'STD-129', 'player'), {
    faceDown: false, sleep: false, summoningSick: false
  });
  assert.equal(placeCardInBoardSlot(source.engineState.players.player.front, security,
    { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  const ready = rebuilt(source);
  const ended = submitRuntimeCommand(ready, context(), command({ commandId: 'open-security', action: { type: 'endTurn' } }));
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.equal(ended.value.publicResult.requiredInput.choiceId, 'choice:1:security-rest');
  const declined = submitRuntimeCommand(ended.value.authority, context(), command({
    commandId: 'decline-security', expectedRevision: 1,
    action: { type: 'declineChoice', choiceId: 'choice:1:security-rest' }
  }));
  assert.equal(declined.ok, true, JSON.stringify(declined));
  assert.equal(declined.value.kind, 'accepted');
  assert.equal(declined.value.authority.engineState.securityRestWindow ?? null, null);
  assert.equal(declined.value.authority.engineState.active, 'ai');
});

test('S04-TRX-04: headless damage opens and resolves a Response without the GUI interactive flag', () => {
  const source = authority({ mode: 'ai' });
  const engine = source.engineState;
  engine.active = 'ai';
  engine.interactive = false;
  engine.players.player.memory = 3;
  const response = createRuntimeCard(engine.runtimeContext, 'STD-132', 'player');
  const yellowSymbol = Object.assign(createRuntimeCard(engine.runtimeContext, 'STD-129', 'player'), { faceDown: false });
  const attacker = Object.assign(createRuntimeCard(engine.runtimeContext, 'STD-020', 'ai'), {
    faceDown: false, sleep: false, summoningSick: false
  });
  engine.players.player.hand.push(response);
  engine.players.player.registry.push(yellowSymbol);
  assert.equal(placeCardInBoardSlot(engine.players.ai.front, attacker,
    { controllerId: 'ai', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  const ready = rebuilt(source);
  const attacked = submitRuntimeCommand(ready, context('seat-b'), command({
    commandId: 'headless-attack', actorSeat: 'seat-b',
    action: { type: 'attack', attackerRef: refFor(ready, attacker, 'seat-b'), target: { kind: 'user', seatId: 'seat-a' } }
  }));
  assert.equal(attacked.ok, true, JSON.stringify(attacked));
  assert.equal(attacked.value.authority.engineState.pending?.type, 'response-window');
  assert.equal(attacked.value.publicResult.requiredInput.actorSeat, 'seat-a');
  assert.equal(attacked.value.publicResult.requiredInput.canAnswer, false);
  const responseInput = buildRequiredInput(attacked.value.authority, 'seat-a');
  assert.equal(responseInput.ok, true, JSON.stringify(responseInput));
  const answered = submitRuntimeCommand(attacked.value.authority, context(), command({
    commandId: 'headless-response', expectedRevision: 1,
    action: {
      type: 'answerChoice', choiceId: responseInput.value.choiceId,
      optionIds: [responseInput.value.options[0].optionId], allocation: []
    }
  }));
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.value.kind, 'accepted');
  assert.equal(answered.value.authority.engineState.pending, null);
  assert.equal(answered.value.authority.engineState.players.player.memory, 0);
  assert.equal(answered.value.authority.engineState.players.player.trash.some(card => card.id === 'STD-132'), true);
});

test('S04-TRX-05: trigger order advances through deterministic choice IDs until the thread resolves', () => {
  const source = authority({ mode: 'ai', playerDeckRecipe: [['STD-191', 1], ['STD-192', 1]] });
  const engine = source.engineState;
  const idol = engine.players.player.hand.find(card => card.id === 'STD-191');
  const tana = engine.players.player.hand.find(card => card.id === 'STD-192');
  assert.ok(idol);
  assert.ok(tana);
  engine.players.player.hand = engine.players.player.hand.filter(card => card !== idol && card !== tana);
  assert.equal(placeCardInBoardSlot(engine.players.player.back, idol,
    { controllerId: 'player', zoneName: 'back', limit: 5, requestedSlot: 1 }), true);
  assert.equal(placeCardInBoardSlot(engine.players.player.front, tana,
    { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  engine.players.player.memory = 5;
  const effect = getActivatableEffects(engine, 'player', tana)[0];
  assert.equal(activateCardEffect(engine, 'player', tana.uid, effect.id, { targetUid: tana.uid, targetZone: 'back' }), true);
  assert.equal(engine.pending?.type, 'trigger-order');
  const ready = rebuilt(source);
  const firstInput = buildRequiredInput(ready, 'seat-a');
  assert.equal(firstInput.ok, true, JSON.stringify(firstInput));
  const first = submitRuntimeCommand(ready, context(), command({
    commandId: 'trigger-order-1', action: {
      type: 'answerChoice', choiceId: firstInput.value.choiceId,
      optionIds: [firstInput.value.options[0].optionId], allocation: []
    }
  }));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.authority.engineState.pending?.type, 'trigger-order');
  const secondInput = buildRequiredInput(first.value.authority, 'seat-a');
  assert.equal(secondInput.ok, true, JSON.stringify(secondInput));
  const second = submitRuntimeCommand(first.value.authority, context(), command({
    commandId: 'trigger-order-2', expectedRevision: 1,
    action: {
      type: 'answerChoice', choiceId: secondInput.value.choiceId,
      optionIds: [secondInput.value.options[0].optionId], allocation: []
    }
  }));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.value.authority.engineState.triggerThread?.status, 'resolved');
  assert.equal(second.value.authority.engineState.pending, null);
});

test('S04-TRX-06: lethal headless attack reaches finished and refuses new play commands', () => {
  const source = authority({ mode: 'ai' });
  const engine = source.engineState;
  engine.players.ai.fortressStr = 1;
  const attacker = Object.assign(createRuntimeCard(engine.runtimeContext, 'STD-020', 'player'), {
    faceDown: false, sleep: false, summoningSick: false
  });
  assert.equal(placeCardInBoardSlot(engine.players.player.front, attacker,
    { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  const ready = rebuilt(source);
  const finished = submitRuntimeCommand(ready, context(), command({
    commandId: 'lethal-attack',
    action: { type: 'attack', attackerRef: refFor(ready, attacker), target: { kind: 'user', seatId: 'seat-b' } }
  }));
  assert.equal(finished.ok, true, JSON.stringify(finished));
  assert.equal(finished.value.authority.engineState.victory.lockedOutcome, 'player');
  assert.equal(finished.value.authority.engineState.victory.finished, true);
  assert.equal(finished.value.publicResult.receipt.progress, 'finished');
  assert.equal(finished.value.publicResult.requiredInput, null);
  const blocked = submitRuntimeCommand(finished.value.authority, context(), command({
    commandId: 'after-finish', expectedRevision: 1, action: { type: 'endTurn' }
  }));
  assert.equal(blocked.ok, true, JSON.stringify(blocked));
  assert.equal(blocked.value.kind, 'rejected');
  assert.equal(blocked.value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
});

test('S04-TRX-07: lethal headless attack stays awaitingInput through Response cleanup, then finishes', () => {
  const source = authority({
    mode: 'ai', playerDeckRecipe: [['STD-143', 1], ['STD-129', 1]], aiDeckRecipe: [['STD-020', 1]]
  });
  const engine = source.engineState;
  engine.active = 'ai';
  engine.interactive = false;
  engine.players.player.fortressStr = 1;
  engine.players.player.memory = 10;
  const response = engine.players.player.hand.find(card => card.id === 'STD-143');
  const yellowSymbol = engine.players.player.hand.find(card => card.id === 'STD-129');
  const attacker = engine.players.ai.hand.find(card => card.id === 'STD-020');
  assert.ok(response);
  assert.ok(yellowSymbol);
  assert.ok(attacker);
  engine.players.player.hand = engine.players.player.hand.filter(card => card !== yellowSymbol);
  engine.players.player.registry.push(yellowSymbol);
  engine.players.ai.hand = engine.players.ai.hand.filter(card => card !== attacker);
  attacker.faceDown = false;
  attacker.sleep = false;
  attacker.summoningSick = false;
  assert.equal(placeCardInBoardSlot(engine.players.ai.front, attacker,
    { controllerId: 'ai', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  const ready = rebuilt(source);
  const attacked = submitRuntimeCommand(ready, context('seat-b'), command({
    commandId: 'lethal-response-attack', actorSeat: 'seat-b',
    action: { type: 'attack', attackerRef: refFor(ready, attacker, 'seat-b'), target: { kind: 'user', seatId: 'seat-a' } }
  }));
  assert.equal(attacked.ok, true, JSON.stringify(attacked));
  assert.equal(attacked.value.publicResult.receipt.progress, 'awaitingInput');
  assert.equal(attacked.value.authority.engineState.pending?.type, 'response-window');
  assert.equal(attacked.value.publicResult.requiredInput.actorSeat, 'seat-a');
  const lethalInput = buildRequiredInput(attacked.value.authority, 'seat-a');
  assert.equal(lethalInput.ok, true, JSON.stringify(lethalInput));
  const answered = submitRuntimeCommand(attacked.value.authority, context(), command({
    commandId: 'lethal-response-answer', expectedRevision: 1,
    action: {
      type: 'answerChoice', choiceId: lethalInput.value.choiceId,
      optionIds: [lethalInput.value.options[0].optionId], allocation: []
    }
  }));
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.value.publicResult.receipt.progress, 'finished');
  assert.equal(answered.value.authority.engineState.victory.lockedOutcome, 'ai');
  assert.equal(answered.value.authority.engineState.victory.finished, true);
  assert.equal(answered.value.authority.engineState.pending, null);
});
