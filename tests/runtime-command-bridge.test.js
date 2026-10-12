import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRuntimeCommand } from '../src/game/runtime/command-bridge.js';
import { submitRuntimeCommand } from '../src/game/runtime/transaction.js';
import { buildRequiredInput } from '../src/game/runtime/required-input.js';
import { createCommandJournal, recordTerminal } from '../src/game/runtime/command-record.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { createRuntimeCard } from '../src/game/runtime/factory.js';
import { placeCardInBoardSlot } from '../src/game/board-slots.js';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeIdentityIndex } from '../src/game/runtime/bridge.js';
import { installCard, playCard, supportsNormalScriptActivation } from '../src/game/engine.js';

const baseOptions = () => ({
  mode: 'ai', tutorialId: 'basics', playerDeckId: 'red', aiDeckId: 'yellow', playerDeckRecipe: null,
  aiDeckRecipe: null, playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
});
const baseCommand = (overrides = {}) => ({
  contractVersion: 1, matchId: 'match-a', commandId: 'command-a', actorSeat: 'seat-a', expectedRevision: 0,
  action: { type: 'endTurn' }, ...overrides
});
const contextFor = (actorSeat = 'seat-a', matchId = 'match-a') => ({ matchId, actorSeat });
const baseAuthority = () => {
  const seatIds = ['seat-a', 'seat-b'];
  const startOptions = baseOptions();
  return {
    metadata: { matchId: 'match-a', seatIds, ruleVersion: 'rules-1', cardVersion: 'cards-1', startOptions },
    revision: 0,
    engineState: {
      runtimeContext: {
        matchId: 'match-a', seatIds: [...seatIds],
        identityState: { matchId: 'match-a', seatIds: [...seatIds], nextSerial: 1, retiredIds: [] },
        rngState: { schemaVersion: 1, algorithm: 'mulberry32-v1', seed: 7, cursor: 7, draws: 0 }, uidAliases: []
      },
      mode: 'ai', tutorialId: 'basics', playerDeckId: 'red', aiDeckId: 'yellow', playerUserId: 'doors_zx', aiUserId: 'doors_zx',
      active: 'player', winner: null, victory: { lockedOutcome: null, lockedAtEffectId: null, finished: false },
      phase: 'main', interactive: false,
      pending: null, prompt: null, effectResolution: null, mandatoryDrawContinuation: null,
      resolvingDeclaredEffect: null, deferredDeclaredResponseCleanup: null, deferredDeclaredScriptCleanup: null,
      placementCostBatch: null, selectionQueue: [], triggerQueue: [], scriptActivationQueue: [], declaredEffects: [],
      responseEventQueue: [], victoryFacts: [], processingTriggers: false, resolvingResponse: false, effectDepth: 0, triggerThread: null
    },
    journal: createCommandJournal({ matchId: 'match-a', seatIds }).value
  };
};
const turboFixture = ({ active = 'player', playerAbilityKey = 'turbo', aiAbilityKey = 'watching_you',
  playerTurboUsed = false, aiTurboUsed = false, stateChanges = {} } = {}) => {
  const authority = baseAuthority();
  Object.assign(authority.engineState, stateChanges, { active });
  authority.engineState.players = {
    player: { user: { abilityKey: playerAbilityKey }, turboUsed: playerTurboUsed, turboActive: false },
    ai: { user: { abilityKey: aiAbilityKey }, turboUsed: aiTurboUsed, turboActive: false }
  };
  return authority;
};
const restFixture = ({ cardChanges = {}, stateChanges = {}, owner = 'player', zone = 'front', controller = 'player', mountedProviderIds = [] } = {}) => {
  const authority = baseAuthority();
  const id = cardChanges.id ?? 'STD-129';
  const card = Object.assign(createRuntimeCard(authority.engineState.runtimeContext, id, owner), cardChanges);
  authority.engineState = {
    ...authority.engineState, ...stateChanges,
    players: {
      player: { deck: [], hand: [], front: [], back: [], registry: [], trash: [], ban: [], virtual: [], user: { frontLimit: 5, backLimit: 5 } },
      ai: { deck: [], hand: [], front: [], back: [], registry: [], trash: [], ban: [], virtual: [], user: { frontLimit: 5, backLimit: 5 } }
    }
  };
  assert.equal(placeCardInBoardSlot(authority.engineState.players[controller][zone], card, {
    controllerId: controller, zoneName: zone, limit: 5
  }), true);
  const mounted = mountedProviderIds.map(providerId => {
    const provider = createRuntimeCard(authority.engineState.runtimeContext, providerId, owner);
    provider.layerRole = 'code';
    card.mounted.push(provider);
    return provider;
  });
  const identity = card.identity;
  const seatId = controller === 'player' ? 'seat-a' : 'seat-b';
  const frameCards = [{
    identity: { ...identity }, ownerSeat: card.ownerSeat, controllerSeat: seatId,
    location: { kind: 'board', seatId, zone, position: card.boardSlot }, faceDown: card.faceDown
  }];
  for (const [index, provider] of mounted.entries()) frameCards.push({
    identity: { ...provider.identity }, ownerSeat: provider.ownerSeat, controllerSeat: seatId,
    location: { kind: 'mounted', host: { ...card.identity }, order: index + 1, role: 'mount' }, faceDown: provider.faceDown
  });
  const frame = { matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], cards: frameCards };
  const references = createRuntimeReferenceState({
    frame, newRefs: Array.from({ length: frameCards.length * 2 }, (_, index) => `r:${(index + 1).toString(16).padStart(32, '0')}`)
  });
  assert.equal(references.ok, true);
  authority.referenceState = references.value;
  return { authority, card, cardRef: references.value.entries.find(entry => entry.viewerSeat === 'seat-a').cardRef };
};
const publicRestFixture = () => {
  const session = createRuntimeSession({
    matchId: 'public-rest-match', seatIds: ['seat-a', 'seat-b'], seed: 17, ruleVersion: 'rules-1', cardVersion: 'cards-1',
    gameOptions: { mode: 'ai', playerDeckRecipe: [], aiDeckRecipe: [] }
  });
  assert.equal(session.ok, true);
  const engineState = session.value.engineState;
  engineState.players.player.memory = 20;
  const symbolCard = createRuntimeCard(engineState.runtimeContext, 'STD-129', 'player');
  engineState.players.player.hand.push(symbolCard);
  assert.equal(installCard(engineState, 'player', symbolCard.uid), true);
  const card = createRuntimeCard(engineState.runtimeContext, 'STD-129', 'player');
  engineState.players.player.hand.push(card);
  assert.equal(playCard(engineState, 'player', card.uid), true);
  engineState.securityRestWindow = 'player';
  const index = buildRuntimeIdentityIndex(engineState);
  assert.equal(index.ok, true);
  const frame = {
    matchId: index.value.matchId, seatIds: [...session.value.metadata.seatIds],
    cards: index.value.entries.map(entry => ({ ...entry, faceDown: false }))
  };
  const refs = createRuntimeReferenceState({
    frame, newRefs: Array.from({ length: index.value.entries.length * 2 }, (_, index) => `r:${(index + 3).toString(16).padStart(32, '0')}`)
  });
  assert.equal(refs.ok, true);
  const journal = createCommandJournal({ matchId: session.value.metadata.matchId, seatIds: session.value.metadata.seatIds });
  assert.equal(journal.ok, true);
  return {
    authority: { ...session.value, engineState, journal: journal.value, referenceState: refs.value },
    card,
    cardRef: refs.value.entries.find(entry => entry.viewerSeat === session.value.metadata.seatIds[0]
      && entry.identity.instanceId === card.identity.instanceId).cardRef
  };
};
const restCommand = (cardRef, overrides = {}) => baseCommand({
  action: { type: 'restSecurity', cardRef }, ...overrides
});
const installFixture = ({ id = 'STD-001', owner = 'player', controller = 'player', active = controller, zone = 'hand',
  cardChanges = {}, playerChanges = {}, stateChanges = {}, registryCards = [], mountedCards = [], mode = 'ai' } = {}) => {
  const session = createRuntimeSession({
    matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], seed: 23, ruleVersion: 'rules-1', cardVersion: 'cards-1',
    gameOptions: { mode, playerDeckRecipe: [], aiDeckRecipe: [] }
  });
  assert.equal(session.ok, true);
  const engineState = session.value.engineState;
  Object.assign(engineState, stateChanges, { active });
  Object.assign(engineState.players[controller], playerChanges);
  const card = Object.assign(createRuntimeCard(engineState.runtimeContext, id, owner), cardChanges);
  if (zone === 'front' || zone === 'back') {
    assert.equal(placeCardInBoardSlot(engineState.players[controller][zone], card, {
      controllerId: controller, zoneName: zone, limit: 5
    }), true);
  } else engineState.players[controller][zone].push(card);
  const mounted = mountedCards.map(({ id: mountedId, owner: mountedOwner = owner, cardChanges: changes = {} }) => {
    const item = Object.assign(createRuntimeCard(engineState.runtimeContext, mountedId, mountedOwner), changes);
    item.layerRole = item.layerRole ?? 'code';
    card.mounted.push(item);
    return item;
  });
  const registry = registryCards.map(({ id: registryId, owner: registryOwner = owner, cardChanges: changes = {} }) => {
    const item = Object.assign(createRuntimeCard(engineState.runtimeContext, registryId, registryOwner), changes);
    engineState.players[controller].registry.push(item);
    return item;
  });
  const index = buildRuntimeIdentityIndex(engineState);
  assert.equal(index.ok, true);
  const faceDownById = new Map([card, ...mounted, ...registry].map(item => [item.identity.instanceId, item.faceDown === true]));
  const frame = {
    matchId: index.value.matchId, seatIds: [...session.value.metadata.seatIds],
    cards: index.value.entries.map(entry => ({ ...entry, faceDown: faceDownById.get(entry.identity.instanceId) ?? false }))
  };
  const refsNeeded = frame.cards.reduce((count, entry) => {
    if (entry.location.kind === 'board') return count + 2;
    if (entry.location.kind === 'mounted' && !entry.faceDown) return count + 2;
    if (entry.location.zone === 'hand') return count + 1;
    if (['registry', 'trash', 'ban'].includes(entry.location.zone) && !entry.faceDown) return count + 2;
    return count;
  }, 0);
  const refs = createRuntimeReferenceState({ frame, newRefs: Array.from({
    length: refsNeeded
  }, (_, index) => `r:${(index + 15).toString(16).padStart(32, '0')}`) });
  assert.equal(refs.ok, true);
  const journal = createCommandJournal({ matchId: session.value.metadata.matchId, seatIds: session.value.metadata.seatIds });
  assert.equal(journal.ok, true);
  const actorSeat = session.value.metadata.seatIds[controller === 'player' ? 0 : 1];
  return {
    authority: { ...session.value, engineState, journal: journal.value, referenceState: refs.value },
    actorSeat, card, mounted,
    cardRef: refs.value.entries.find(entry => entry.viewerSeat === actorSeat
      && entry.identity.instanceId === card.identity.instanceId).cardRef
  };
};
const installCommand = (cardRef, overrides = {}) => baseCommand({
  action: { type: 'install', cardRef }, ...overrides
});
const recoverCommand = (cardRef, overrides = {}) => baseCommand({
  action: { type: 'recoverRegistry', cardRef }, ...overrides
});
const activateScriptCommand = (cardRef, overrides = {}) => baseCommand({
  action: { type: 'activateScript', cardRef }, ...overrides
});
const executeCardCommand = (cardRef, zone = 'front', slot = 1, overrides = {}) => baseCommand({
  action: { type: 'executeCard', cardRef, destination: { zone, slot } }, ...overrides
});
const redeployCommand = (cardRef, zone = 'front', slot = 1, overrides = {}) => baseCommand({
  action: { type: 'redeploy', cardRef, destination: { zone, slot } }, ...overrides
});
const openingMulliganCommand = (overrides = {}) => baseCommand({
  action: { type: 'openingMulligan' }, ...overrides
});
const activateTurboCommand = (overrides = {}) => baseCommand({
  action: { type: 'activateAbility', ability: { kind: 'user', key: 'turbo' } }, ...overrides
});
const sandboxAddCommand = (definitionId = 'STD-020', targetSeat = 'seat-a', overrides = {}) => baseCommand({
  action: { type: 'sandboxAddCard', definitionId, targetSeat }, ...overrides
});
const sandboxAddFixture = ({ mode = 'sandbox', active = 'player', stateChanges = {} } = {}) => {
  const authority = baseAuthority();
  authority.metadata.startOptions.mode = mode;
  Object.assign(authority.engineState, stateChanges, { mode, active });
  authority.engineState.players = { player: {}, ai: {} };
  return authority;
};
const attackCommand = (attackerRef, target, overrides = {}) => baseCommand({
  action: { type: 'attack', attackerRef, target }, ...overrides
});
const attackFixture = ({ playerId = 'player', attackerId = 'STD-020', targetId = 'STD-020',
  attackerChanges = {}, targetChanges = {}, targetZone = 'front' } = {}) => {
  const session = createRuntimeSession({
    matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], seed: 31, ruleVersion: 'rules-1', cardVersion: 'cards-1',
    gameOptions: { mode: 'ai', playerDeckRecipe: [], aiDeckRecipe: [] }
  });
  assert.equal(session.ok, true);
  const engineState = session.value.engineState;
  const opponentId = playerId === 'player' ? 'ai' : 'player';
  engineState.active = playerId;
  engineState.players[playerId].scriptActivatedTurn = engineState.turnNumber;
  engineState.players[opponentId].scriptActivatedTurn = engineState.turnNumber;
  const attacker = Object.assign(createRuntimeCard(engineState.runtimeContext, attackerId, playerId), {
    sleep: false, summoningSick: false
  }, attackerChanges);
  const target = Object.assign(createRuntimeCard(engineState.runtimeContext, targetId, opponentId), {
    sleep: true, summoningSick: false
  }, targetChanges);
  assert.equal(placeCardInBoardSlot(engineState.players[playerId].front, attacker,
    { controllerId: playerId, zoneName: 'front', limit: 5 }), true);
  assert.equal(placeCardInBoardSlot(engineState.players[opponentId][targetZone], target,
    { controllerId: opponentId, zoneName: targetZone, limit: 5 }), true);
  const index = buildRuntimeIdentityIndex(engineState);
  assert.equal(index.ok, true);
  const frame = {
    matchId: index.value.matchId, seatIds: [...session.value.metadata.seatIds],
    cards: index.value.entries.map(entry => ({ ...entry, faceDown: false }))
  };
  const refs = createRuntimeReferenceState({
    frame, newRefs: Array.from({ length: frame.cards.length * 2 },
      (_, indexValue) => `r:${(indexValue + 101).toString(16).padStart(32, '0')}`)
  });
  assert.equal(refs.ok, true);
  const actorSeat = session.value.metadata.seatIds[playerId === 'player' ? 0 : 1];
  const opponentSeat = session.value.metadata.seatIds[opponentId === 'player' ? 0 : 1];
  const refFor = card => refs.value.entries.find(entry => entry.viewerSeat === actorSeat
    && entry.identity.instanceId === card.identity.instanceId).cardRef;
  const journal = createCommandJournal({ matchId: 'match-a', seatIds: session.value.metadata.seatIds });
  assert.equal(journal.ok, true);
  return {
    authority: { ...session.value, engineState, journal: journal.value, referenceState: refs.value },
    playerId, opponentId, actorSeat, opponentSeat, attacker, target,
    attackerRef: refFor(attacker), targetRef: refFor(target)
  };
};
const executeLayeredCommand = (cardRef, materialRefs, zone = 'front', slot = 5, overrides = {}) => baseCommand({
  action: { type: 'executeLayered', cardRef, materialRefs, destination: { zone, slot } }, ...overrides
});
const layeredFixture = ({ playerId = 'player', sourceId = 'STD-232', sourceChanges = {},
  materialSpecs = [{ id: 'STD-020', zone: 'front' }, { id: 'STD-021', zone: 'registry' }],
  destinationZone = 'back', destinationSlot = 5, occupyDestination = false } = {}) => {
  const session = createRuntimeSession({
    matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], seed: 37, ruleVersion: 'rules-1', cardVersion: 'cards-1',
    gameOptions: { mode: 'ai', playerDeckRecipe: [], aiDeckRecipe: [] }
  });
  assert.equal(session.ok, true);
  const engineState = session.value.engineState;
  engineState.active = playerId;
  engineState.players[playerId].memory = 30;
  const source = Object.assign(createRuntimeCard(engineState.runtimeContext, sourceId, playerId),
    { color: null }, sourceChanges);
  engineState.players[playerId].hand.push(source);
  const materials = materialSpecs.map((spec, indexValue) => {
    const controller = spec.controller ?? playerId;
    const owner = spec.owner ?? controller;
    const card = Object.assign(createRuntimeCard(engineState.runtimeContext, spec.id, owner),
      { faceDown: false }, spec.changes ?? {});
    if (spec.zone === 'front' || spec.zone === 'back') {
      assert.equal(placeCardInBoardSlot(engineState.players[controller][spec.zone], card, {
        controllerId: controller, zoneName: spec.zone, limit: 5, requestedSlot: spec.slot ?? indexValue + 1
      }), true);
    } else engineState.players[controller][spec.zone].push(card);
    return card;
  });
  if (occupyDestination) {
    const blocker = createRuntimeCard(engineState.runtimeContext, 'STD-023', playerId);
    assert.equal(placeCardInBoardSlot(engineState.players[playerId][destinationZone], blocker, {
      controllerId: playerId, zoneName: destinationZone, limit: 5, requestedSlot: destinationSlot
    }), true);
  }
  const index = buildRuntimeIdentityIndex(engineState);
  assert.equal(index.ok, true);
  const cards = [source, ...materials];
  const faceDown = new Map(cards.map(card => [card.identity.instanceId, card.faceDown]));
  const frame = {
    matchId: index.value.matchId, seatIds: [...session.value.metadata.seatIds],
    cards: index.value.entries.map(entry => ({ ...entry, faceDown: faceDown.get(entry.identity.instanceId) ?? false }))
  };
  const refsNeeded = frame.cards.reduce((count, entry) => {
    if (entry.location.kind === 'board') return count + 2;
    if (entry.location.zone === 'hand') return count + 1;
    if (['registry', 'trash', 'ban'].includes(entry.location.zone) && !entry.faceDown) return count + 2;
    return count;
  }, 0);
  const refs = createRuntimeReferenceState({
    frame, newRefs: Array.from({ length: refsNeeded },
      (_, indexValue) => `r:${(indexValue + 201).toString(16).padStart(32, '0')}`)
  });
  assert.equal(refs.ok, true);
  const actorSeat = session.value.metadata.seatIds[playerId === 'player' ? 0 : 1];
  const refFor = card => refs.value.entries.find(entry => entry.viewerSeat === actorSeat
    && entry.identity.instanceId === card.identity.instanceId)?.cardRef;
  const journal = createCommandJournal({ matchId: 'match-a', seatIds: session.value.metadata.seatIds });
  assert.equal(journal.ok, true);
  return {
    authority: { ...session.value, engineState, journal: journal.value, referenceState: refs.value },
    playerId, actorSeat, source, materials, sourceRef: refFor(source), materialRefs: materials.map(refFor),
    destinationZone, destinationSlot
  };
};
const mulliganFixture = ({ active = 'player', abilityKey = 'watching_you', initialHand = 5,
  mulligansUsed = 0, turnNumber = 1, handCount = initialHand ?? 5, occupiedZone = null } = {}) => {
  const authority = baseAuthority();
  authority.engineState.active = active;
  authority.engineState.turnNumber = turnNumber;
  const build = id => ({
    user: { abilityKey: id === active ? abilityKey : 'turbo_boost', initialHand: id === active ? initialHand : 5 },
    mulligansUsed: id === active ? mulligansUsed : 0,
    hand: Array.from({ length: id === active ? handCount : 5 }, () => null),
    front: [], back: [], registry: [], trash: [], ban: []
  });
  authority.engineState.players = { player: build('player'), ai: build('ai') };
  if (occupiedZone) authority.engineState.players[active][occupiedZone].push(null);
  const actorSeat = active === 'player' ? 'seat-a' : 'seat-b';
  return { authority, actorSeat, command: openingMulliganCommand({ actorSeat }) };
};
const deepFreeze = (value, seen = new Set()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
};
const accepted = { status: 'accepted', revision: 1, reasonCode: 'ACCEPTED' };
const code = (result, expected) => assert.deepEqual(result, { ok: false, error: { code: expected } });

test('S03-CBR-01: prepares exact endTurn adapter data from active player seat', () => {
  const authority = baseAuthority();
  const result = prepareRuntimeCommand(authority, contextFor(), baseCommand());
  assert.deepEqual(result, { ok: true, value: {
    kind: 'prepared', command: baseCommand(),
    canonicalPayload: '{"action":{"type":"endTurn"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}',
    adapter: { engineFunction: 'endTurn', playerId: 'player' }
  } });
});

test('S03-CBR-02: prepared command is a detached copy and inputs stay unchanged', () => {
  const command = baseCommand();
  const authority = baseAuthority();
  const context = contextFor();
  const authorityBefore = structuredClone(authority);
  const contextBefore = structuredClone(context);
  const before = structuredClone(command);
  const result = prepareRuntimeCommand(authority, context, command);
  result.value.command.action.type = 'changed';
  assert.deepEqual(command, before);
  assert.deepEqual(context, contextBefore);
  assert.deepEqual(authority, authorityBefore);
});

test('S03-CBR-03: canonical command errors pass through before authority access', () => {
  const untouched = new Proxy({}, { getPrototypeOf() { throw new Error('authority must not be read'); } });
  code(prepareRuntimeCommand(untouched, contextFor(), { type: 'endTurn' }), 'INVALID_COMMAND');
});

test('S03-CBR-04: exact trusted context mismatch is rejected before authority data', () => {
  const untouched = new Proxy({}, { getPrototypeOf() { throw new Error('authority must not be read'); } });
  code(prepareRuntimeCommand(untouched, contextFor('seat-b'), baseCommand()), 'NOT_AUTHORIZED');
  code(prepareRuntimeCommand(baseAuthority(), { ...contextFor(), extra: true }, baseCommand()), 'NOT_AUTHORIZED');
});

test('S03-CBR-05: authority envelope must be exact and public metadata must be structurally valid', () => {
  const extra = { ...baseAuthority(), private: true };
  code(prepareRuntimeCommand(extra, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
  const malformed = baseAuthority(); malformed.metadata.startOptions.mode = 5;
  code(prepareRuntimeCommand(malformed, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
});

test('S03-CBR-06: public metadata scope authorization precedes engine and journal inspection', () => {
  const authority = baseAuthority();
  authority.metadata.matchId = 'other';
  let getterCalls = 0;
  Object.defineProperty(authority.metadata, 'startOptions', { enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error('private recipe must remain unread'); } });
  for (const field of ['engineState', 'revision', 'journal']) Object.defineProperty(authority, field, {
    enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error(`${field} must remain unread`); }
  });
  code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'NOT_AUTHORIZED');
  assert.equal(getterCalls, 0);

  const unregistered = baseAuthority();
  unregistered.metadata.seatIds = ['seat-a', 'seat-c'];
  Object.defineProperty(unregistered.metadata.startOptions, 'playerDeckRecipe', {
    enumerable: false, configurable: true, get() { getterCalls += 1; throw new Error('recipe must remain unread'); }
  });
  for (const field of ['engineState', 'revision', 'journal']) Object.defineProperty(unregistered, field, {
    enumerable: false, configurable: true, value: unregistered[field]
  });
  code(prepareRuntimeCommand(unregistered, contextFor('seat-b'), baseCommand({ actorSeat: 'seat-b' })), 'NOT_AUTHORIZED');
  assert.equal(getterCalls, 0);
});

test('S03-CBR-07: journal retry returns before revision or engine validation', () => {
  const authority = baseAuthority();
  authority.journal = recordTerminal(authority.journal, contextFor(), baseCommand(), accepted).value;
  let getterCalls = 0;
  authority.metadata.startOptions = { mode: 'invalid', playerDeckRecipe: [] };
  Object.defineProperty(authority.metadata.startOptions, 'playerDeckRecipe', {
    enumerable: true, get() { getterCalls += 1; throw new Error('recipe must remain unread on retry'); }
  });
  Object.defineProperty(authority, 'revision', { enumerable: true, get() { getterCalls += 1; throw new Error('revision must remain unread'); } });
  Object.defineProperty(authority, 'engineState', { enumerable: true, get() { getterCalls += 1; throw new Error('engine must remain unread on retry'); } });
  assert.deepEqual(prepareRuntimeCommand(authority, contextFor(), baseCommand()), {
    ok: true, value: { kind: 'retry', receipt: authority.journal.entries[0].receipt }
  });
  assert.equal(getterCalls, 0);
});

test('S03-CBR-08: journal errors and command collisions propagate unchanged', () => {
  const bad = baseAuthority(); bad.journal.entries.push({});
  const badContext = contextFor();
  const badCommand = baseCommand();
  const badBefore = structuredClone(bad);
  const badContextBefore = structuredClone(badContext);
  const badCommandBefore = structuredClone(badCommand);
  code(prepareRuntimeCommand(bad, badContext, badCommand), 'INVALID_JOURNAL');
  assert.deepEqual(bad, badBefore);
  assert.deepEqual(badContext, badContextBefore);
  assert.deepEqual(badCommand, badCommandBefore);
  const recorded = baseAuthority(); recorded.journal = recordTerminal(recorded.journal, contextFor(), baseCommand(), accepted).value;
  const collisionContext = contextFor();
  const collisionCommand = baseCommand({ expectedRevision: 1 });
  const recordedBefore = structuredClone(recorded);
  const collisionContextBefore = structuredClone(collisionContext);
  const collisionCommandBefore = structuredClone(collisionCommand);
  code(prepareRuntimeCommand(recorded, collisionContext, collisionCommand), 'COMMAND_ID_COLLISION');
  assert.deepEqual(recorded, recordedBefore);
  assert.deepEqual(collisionContext, collisionContextBefore);
  assert.deepEqual(collisionCommand, collisionCommandBefore);
});

test('S03-CBR-09: metadata startOptions preserve the current exact nine-field producer shape', () => {
  const authority = baseAuthority();
  delete authority.metadata.startOptions.aiDeckRecipe;
  code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
  const recipe = baseAuthority(); recipe.metadata.startOptions.playerDeckRecipe = [['STD-001', 2]];
  assert.equal(prepareRuntimeCommand(recipe, contextFor(), baseCommand()).ok, true);
});

test('S03-CBR-10: journal seat order and runtime scope must match public metadata', () => {
  const journal = baseAuthority();
  journal.journal = createCommandJournal({ matchId: 'match-a', seatIds: ['seat-b', 'seat-a'] }).value;
  code(prepareRuntimeCommand(journal, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
  const runtime = baseAuthority(); runtime.engineState.runtimeContext.matchId = 'other';
  code(prepareRuntimeCommand(runtime, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
});

test('S03-CBR-11: malformed revision fails authority validation after a new-command classification', () => {
  for (const revision of [-0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const authority = baseAuthority(); authority.revision = revision;
    code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
  }
});

test('S03-CBR-12: stale revision and exhausted current revision have separate outcomes', () => {
  const stale = baseAuthority(); stale.revision = 2;
  code(prepareRuntimeCommand(stale, contextFor(), baseCommand({ expectedRevision: 1 })), 'STALE_REVISION');
  const max = baseAuthority(); max.revision = Number.MAX_SAFE_INTEGER;
  code(prepareRuntimeCommand(max, contextFor(), baseCommand({ expectedRevision: Number.MAX_SAFE_INTEGER })), 'REVISION_EXHAUSTED');
});

test('S03-CBR-13: tutorial is explicitly unavailable while AI, lab, and sandbox can prepare', () => {
  const tutorial = baseAuthority(); tutorial.metadata.startOptions.mode = 'tutorial'; tutorial.engineState.mode = 'tutorial';
  code(prepareRuntimeCommand(tutorial, contextFor(), baseCommand()), 'UNAVAILABLE_MODE');
  for (const mode of ['ai', 'lab', 'sandbox']) {
    const authority = baseAuthority(); authority.metadata.startOptions.mode = mode; authority.engineState.mode = mode;
    assert.equal(prepareRuntimeCommand(authority, contextFor(), baseCommand()).ok, true);
  }
});

test('S03-CBR-14: seat index zero maps to player and index one maps to AI', () => {
  const authority = baseAuthority(); authority.engineState.active = 'ai';
  const command = baseCommand({ actorSeat: 'seat-b' });
  assert.deepEqual(prepareRuntimeCommand(authority, contextFor('seat-b'), command).value.adapter, { engineFunction: 'endTurn', playerId: 'ai' });
  code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-15: locked or finished results refuse commands after active-seat validation', () => {
  const winner = baseAuthority(); winner.engineState.winner = 'player'; winner.engineState.victory.lockedOutcome = 'player';
  code(prepareRuntimeCommand(winner, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
  const finished = baseAuthority();
  finished.engineState.winner = 'player'; finished.engineState.victory.lockedOutcome = 'player'; finished.engineState.victory.finished = true;
  code(prepareRuntimeCommand(finished, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-16: required idle fields, queues, flags, and trigger thread are enforced', () => {
  for (const field of ['pending', 'prompt', 'effectResolution', 'mandatoryDrawContinuation', 'resolvingDeclaredEffect',
    'deferredDeclaredResponseCleanup', 'deferredDeclaredScriptCleanup', 'placementCostBatch']) {
    const authority = baseAuthority(); authority.engineState[field] = { active: true };
    code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
  }
  for (const field of ['selectionQueue', 'triggerQueue', 'scriptActivationQueue', 'declaredEffects', 'responseEventQueue', 'victoryFacts']) {
    const authority = baseAuthority(); authority.engineState[field] = [{}];
    code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
  }
  const triggerBusy = baseAuthority(); triggerBusy.engineState.triggerThread = { status: 'resolving' };
  code(prepareRuntimeCommand(triggerBusy, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
  const resolved = baseAuthority(); resolved.engineState.triggerThread = { status: 'resolved' };
  assert.equal(prepareRuntimeCommand(resolved, contextFor(), baseCommand()).ok, true);
});

test('S03-CBR-17: optional continuation fields enforce exact type and busy classification', () => {
  const verify = (field, idleValues, busyValues, invalidValues) => {
    for (const value of idleValues) {
      const authority = baseAuthority(); if (value !== Symbol.for('absent')) authority.engineState[field] = value;
      assert.equal(prepareRuntimeCommand(authority, contextFor(), baseCommand()).ok, true, `${field} idle`);
    }
    for (const value of busyValues) {
      const authority = baseAuthority(); if (value !== Symbol.for('absent')) authority.engineState[field] = value;
      code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'ACTION_NOT_ALLOWED');
    }
    for (const value of invalidValues) {
      const authority = baseAuthority(); if (value !== Symbol.for('absent')) authority.engineState[field] = value;
      code(prepareRuntimeCommand(authority, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
    }
  };
  const absent = Symbol.for('absent');
  for (const field of ['deferredAttack', 'deferredDestruction', 'deferredSpellCleanup', 'std230AmbushCleanup']) {
    verify(field, [absent, null], [{}], ['bad', []]);
  }
  for (const field of ['std142DestroyBatch', 'std211DestructionBatch', 'std094TurnEndQueue', 'std141TurnEndQueue', 'std142TurnEndQueue']) {
    verify(field, [absent], [{}], [null, []]);
  }
  for (const field of ['runtimeDestructionContinuations', 'std142DestructionContinuations', 'std211DestructionContinuations', 'destroyLkiFollowUps']) {
    verify(field, [absent, {}], [{ pending: true }], [null, []]);
  }
  for (const field of ['deferredTrashMoves', 'independentEffects']) verify(field, [absent, []], [[{}]], [null, {}]);
  for (const field of ['drainingIndependentEffects', 'resolvingStd165', 'skipSavageTurnEnd']) verify(field, [absent, false], [true], ['true', 1]);
  for (const field of ['securityRestWindow', 'std094TurnEndDone', 'std141TurnEndDone', 'std142TurnEndDone', 'resumeTurnEndAfterSelection']) {
    verify(field, [absent], ['player', 'ai'], ['unknown', 1, null]);
  }
  verify('attackResumeStage', [absent], ['start', 'std182-script', 'after-declare', 'after-battle'], ['unknown', null, 1]);
  const interactive = baseAuthority(); interactive.engineState.interactive = true;
  assert.equal(prepareRuntimeCommand(interactive, contextFor(), baseCommand()).ok, true);
});

test('S03-CBR-18: engine schema and metadata consistency errors are not normalized into commands', () => {
  const mode = baseAuthority(); mode.engineState.mode = 'unknown';
  code(prepareRuntimeCommand(mode, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
  const runtimeSeats = baseAuthority(); runtimeSeats.engineState.runtimeContext.seatIds = ['seat-b', 'seat-a'];
  code(prepareRuntimeCommand(runtimeSeats, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
});

test('S03-CBR-19: prepares a reference-bound restSecurity adapter without executing the action', () => {
  const { authority, cardRef, card } = publicRestFixture();
  const publicContext = { matchId: authority.metadata.matchId, actorSeat: authority.metadata.seatIds[0] };
  const result = prepareRuntimeCommand(authority, publicContext, restCommand(cardRef, { matchId: authority.metadata.matchId }));
  assert.deepEqual(result.value.adapter, { engineFunction: 'restSecurity', playerId: 'player', uid: card.uid });
  assert.equal(result.value.kind, 'prepared');
  const ai = restFixture({ owner: 'ai', controller: 'ai', stateChanges: { active: 'ai', securityRestWindow: 'ai' } });
  const aiSeat = ai.authority.referenceState.seatIds[1];
  const aiRef = ai.authority.referenceState.entries.find(entry => entry.viewerSeat === aiSeat).cardRef;
  const aiResult = prepareRuntimeCommand(ai.authority, contextFor(aiSeat), restCommand(aiRef, { actorSeat: aiSeat }));
  assert.deepEqual(aiResult.value.adapter, { engineFunction: 'restSecurity', playerId: 'ai', uid: ai.authority.engineState.players.ai.front[0].uid });
});

test('S03-CBR-20: restSecurity requires the five-field authority only for its action', () => {
  const { authority, cardRef } = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const noRefs = { ...authority }; delete noRefs.referenceState;
  code(prepareRuntimeCommand(noRefs, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  code(prepareRuntimeCommand({ ...baseAuthority(), referenceState: authority.referenceState }, contextFor(), baseCommand()), 'INVALID_AUTHORITY');
  const badToken = restCommand('r:bad');
  code(prepareRuntimeCommand(authority, contextFor(), badToken), 'INVALID_COMMAND');
});

test('S03-CBR-21: rest window actor is checked before private reference state access', () => {
  const { authority, cardRef } = restFixture({ stateChanges: { securityRestWindow: 'ai' } });
  let reads = 0;
  Object.defineProperty(authority, 'referenceState', { enumerable: true, configurable: true, get() { reads += 1; throw new Error('must remain unread'); } });
  code(prepareRuntimeCommand(authority, contextFor(), restCommand(cardRef)), 'ACTION_NOT_ALLOWED');
  assert.equal(reads, 0);
});

test('S03-CBR-22: an exact restSecurity retry returns before private reference state access', () => {
  const { authority, cardRef } = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const command = restCommand(cardRef);
  authority.journal = recordTerminal(authority.journal, contextFor(), command, accepted).value;
  let reads = 0;
  Object.defineProperty(authority, 'referenceState', { enumerable: true, configurable: true, get() { reads += 1; throw new Error('retry must not inspect refs'); } });
  assert.equal(prepareRuntimeCommand(authority, contextFor(), command).value.kind, 'retry');
  assert.equal(reads, 0);
});

test('S03-CBR-23: malformed reference tables, scope, frame, or physical identity are invalid authority', () => {
  const { authority, cardRef } = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const sparse = structuredClone(authority); sparse.referenceState.issuedRefs = new Array(1);
  code(prepareRuntimeCommand(sparse, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const duplicate = structuredClone(authority); duplicate.referenceState.issuedRefs.push(duplicate.referenceState.issuedRefs[0]);
  code(prepareRuntimeCommand(duplicate, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const wrongScope = structuredClone(authority); wrongScope.referenceState.matchId = 'other';
  code(prepareRuntimeCommand(wrongScope, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const drift = structuredClone(authority); drift.engineState.players.player.front[0].identity.instanceId = 'i:2';
  code(prepareRuntimeCommand(drift, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const extraArrayKey = structuredClone(authority); extraArrayKey.referenceState.issuedRefs.extra = 'unexpected';
  code(prepareRuntimeCommand(extraArrayKey, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const symbolArrayKey = structuredClone(authority); symbolArrayKey.referenceState.issuedRefs[Symbol('extra')] = 'unexpected';
  code(prepareRuntimeCommand(symbolArrayKey, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const accessorIndex = structuredClone(authority);
  Object.defineProperty(accessorIndex.referenceState.entries, '0', { enumerable: true, configurable: true, get() { throw new Error('entry must not be read'); } });
  code(prepareRuntimeCommand(accessorIndex, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const nestedAccessor = structuredClone(authority);
  let reads = 0;
  Object.defineProperty(nestedAccessor.referenceState.entries[0], 'identity', { enumerable: true, configurable: true, get() { reads += 1; return {}; } });
  code(prepareRuntimeCommand(nestedAccessor, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const fakeSeats = structuredClone(authority);
  fakeSeats.referenceState.seatIds = Object.assign(Object.create(Array.prototype), { 0: 'seat-a', 1: 'seat-b', length: 2 });
  code(prepareRuntimeCommand(fakeSeats, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const sparseEntries = structuredClone(authority); sparseEntries.referenceState.entries = new Array(1);
  code(prepareRuntimeCommand(sparseEntries, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
  const makeFakeArray = values => {
    const value = Object.create(Array.prototype);
    Object.defineProperty(value, 'length', { value: values.length, writable: true, enumerable: false, configurable: false });
    values.forEach((item, index) => Object.defineProperty(value, String(index), {
      value: item, writable: true, enumerable: true, configurable: true
    }));
    return value;
  };
  for (const field of ['seatIds', 'issuedRefs', 'entries']) {
    for (const kind of ['fake', 'hole', 'accessor', 'extra-string', 'extra-symbol']) {
      const candidate = structuredClone(authority);
      const array = candidate.referenceState[field];
      let getterCalls = 0;
      if (kind === 'fake') candidate.referenceState[field] = makeFakeArray(array);
      else if (kind === 'hole') candidate.referenceState[field] = new Array(array.length);
      else if (kind === 'accessor') {
        const first = array[0];
        Object.defineProperty(array, '0', { enumerable: true, configurable: true, get() { getterCalls += 1; return first; } });
      } else if (kind === 'extra-string') array.extra = true;
      else array[Symbol('extra')] = true;
      code(prepareRuntimeCommand(candidate, contextFor(), restCommand(cardRef)), 'INVALID_AUTHORITY');
      assert.equal(getterCalls, 0, `${field} ${kind}`);
    }
  }
  assert.equal(reads, 0);
});

test('S03-CBR-24: unavailable viewer mapping or opaque handle is an action refusal, not a state rewrite', () => {
  const { authority, cardRef } = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const otherViewerRef = authority.referenceState.entries.find(entry => entry.viewerSeat === 'seat-b').cardRef;
  code(prepareRuntimeCommand(authority, contextFor(), restCommand(otherViewerRef)), 'ACTION_NOT_ALLOWED');
  code(prepareRuntimeCommand(authority, contextFor(), restCommand(`r:${'f'.repeat(32)}`)), 'ACTION_NOT_ALLOWED');
  assert.equal(authority.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a').cardRef, cardRef);
});

test('S03-CBR-25: restSecurity accepts only a real front card controlled by the actor', () => {
  const back = restFixture({ zone: 'back', stateChanges: { securityRestWindow: 'player' } });
  code(prepareRuntimeCommand(back.authority, contextFor(), restCommand(back.cardRef)), 'ACTION_NOT_ALLOWED');
  const otherController = restFixture({ zone: 'front', controller: 'ai', ownerSeat: 'seat-b', owner: 'ai', stateChanges: { securityRestWindow: 'player' } });
  code(prepareRuntimeCommand(otherController.authority, contextFor(), restCommand(otherController.cardRef)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-26: face-down, sleeping, non-Ob, and non-Security cards cannot be rested', () => {
  for (const cardChanges of [
    { faceDown: true }, { sleep: true }, { category: 'Lyd', printedCategory: 'Lyd' },
    { id: 'STD-101', name: 'ordinary Ob', category: 'Ob', printedCategory: 'Ob' }
  ]) {
    const fixture = restFixture({ cardChanges, stateChanges: { securityRestWindow: 'player' } });
    code(prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef)), 'ACTION_NOT_ALLOWED');
  }
  const selectedGetter = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  let reads = 0;
  Object.defineProperty(selectedGetter.card, 'category', { enumerable: true, configurable: true, get() { reads += 1; return 'Ob'; } });
  code(prepareRuntimeCommand(selectedGetter.authority, contextFor(), restCommand(selectedGetter.cardRef)), 'INVALID_AUTHORITY');
  assert.equal(reads, 0);
  const fakeKeywords = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  fakeKeywords.card.compiled = { keywords: Object.create(Array.prototype) };
  Object.defineProperty(fakeKeywords.card.compiled.keywords, 'length', { value: 1, enumerable: false, configurable: false });
  Object.defineProperty(fakeKeywords.card.compiled.keywords, '0', { value: { name: 'SECURITY' }, enumerable: true, configurable: true });
  code(prepareRuntimeCommand(fakeKeywords.authority, contextFor(), restCommand(fakeKeywords.cardRef)), 'INVALID_AUTHORITY');

  for (const [intrinsic, expected] of [[Symbol.for('missing'), true], [null, true], [undefined, true], [true, true], [false, false]]) {
    const fixture = restFixture({ stateChanges: { securityRestWindow: 'player' } });
    const keyword = { name: 'SECURITY' };
    if (intrinsic !== Symbol.for('missing')) Object.defineProperty(keyword, 'intrinsic', { value: intrinsic, enumerable: true });
    fixture.card.compiled = { keywords: [keyword] };
    const result = prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef));
    if (expected) assert.equal(result.ok, true);
    else code(result, 'ACTION_NOT_ALLOWED');
  }
  for (const descriptor of [
    { enumerable: true, get() { reads += 1; return true; } },
    { enumerable: false, value: true }
  ]) {
    const fixture = restFixture({ stateChanges: { securityRestWindow: 'player' } });
    const keyword = { name: 'SECURITY' };
    Object.defineProperty(keyword, 'intrinsic', { configurable: true, ...descriptor });
    fixture.card.compiled = { keywords: [keyword] };
    code(prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef)), 'INVALID_AUTHORITY');
  }
  const invalidIntrinsic = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  invalidIntrinsic.card.compiled = { keywords: [{ name: 'SECURITY', intrinsic: 1 }] };
  code(prepareRuntimeCommand(invalidIntrinsic.authority, contextFor(), restCommand(invalidIntrinsic.cardRef)), 'INVALID_AUTHORITY');
  const selectedCases = [
    ['printedCategory', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => [fixture.card, 'printedCategory']],
    ['compiled root', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => [fixture.card, 'compiled']],
    ['grantedKeywords', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => [fixture.card, 'grantedKeywords']],
    ['timedModifiers', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => [fixture.card, 'timedModifiers']],
    ['mounted', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => [fixture.card, 'mounted']],
    ['compiled.keywords', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => {
      fixture.card.compiled = {};
      return [fixture.card.compiled, 'keywords'];
    }],
    ['keyword item.name', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => {
      const item = {};
      fixture.card.compiled = { keywords: [item] };
      return [item, 'name'];
    }],
    ['timed item.keyword', () => restFixture({ stateChanges: { securityRestWindow: 'player' } }), fixture => {
      const item = {};
      fixture.card.timedModifiers = [item];
      return [item, 'keyword'];
    }],
    ['provider.id', () => restFixture({ mountedProviderIds: ['STD-080'], stateChanges: { securityRestWindow: 'player' } }), fixture => [fixture.card.mounted[0], 'id']]
  ];
  for (const [label, makeFixture, select] of selectedCases) {
    const fixture = makeFixture();
    const [target, key] = select(fixture);
    let getterCalls = 0;
    Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error(`${label} accessor`); } });
    code(prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef)), 'INVALID_AUTHORITY');
    assert.equal(getterCalls, 0, label);
  }
  assert.equal(reads, 0);
});

test('S03-CBR-27: registered card owner may differ from the front controller', () => {
  const fixture = restFixture({ owner: 'ai', stateChanges: { securityRestWindow: 'player' } });
  const result = prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef));
  assert.deepEqual(result.value.adapter, { engineFunction: 'restSecurity', playerId: 'player', uid: 'rt:i:1' });
});

test('S03-CBR-28: restSecurity preserves frozen authority, reference, context, and command inputs', () => {
  const fixture = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  let unselectedReads = 0;
  Object.defineProperty(fixture.card, 'unselectedCanary', { enumerable: true, get() { unselectedReads += 1; throw new Error('unselected field read'); } });
  const command = restCommand(fixture.cardRef);
  const context = Object.freeze(contextFor());
  const result = prepareRuntimeCommand(fixture.authority, context, command);
  assert.equal(result.ok, true);
  assert.deepEqual(command.action, { type: 'restSecurity', cardRef: fixture.cardRef });
  assert.equal(unselectedReads, 0);

  const frozen = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const before = structuredClone(frozen.authority);
  const frozenCommand = restCommand(frozen.cardRef);
  deepFreeze(frozen.authority);
  deepFreeze(frozenCommand);
  assert.equal(prepareRuntimeCommand(frozen.authority, context, frozenCommand).ok, true);
  assert.deepEqual(frozen.authority, before);
  assert.deepEqual(frozenCommand.action, { type: 'restSecurity', cardRef: frozen.cardRef });

  const granted = restFixture({ cardChanges: { id: 'STD-101', text: '', grantedKeywords: ['SECURITY'] }, stateChanges: { securityRestWindow: 'player' } });
  assert.equal(prepareRuntimeCommand(granted.authority, contextFor(), restCommand(granted.cardRef)).ok, true);
  const timed = restFixture({ cardChanges: { id: 'STD-101', text: '', timedModifiers: [{ keyword: 'SECURITY' }] }, stateChanges: { securityRestWindow: 'player' } });
  assert.equal(prepareRuntimeCommand(timed.authority, contextFor(), restCommand(timed.cardRef)).ok, true);
  const mounted = restFixture({ cardChanges: { id: 'STD-101', text: '' }, mountedProviderIds: ['STD-080'], stateChanges: { securityRestWindow: 'player' } });
  assert.equal(prepareRuntimeCommand(mounted.authority, contextFor(), restCommand(mounted.cardRef)).ok, true);
  for (const value of [Symbol.for('missing'), null, undefined, true, false]) {
    const fixture = restFixture({ cardChanges: { id: 'STD-101', text: '' }, mountedProviderIds: ['STD-080'], stateChanges: { securityRestWindow: 'player' } });
    if (value !== Symbol.for('missing')) Object.defineProperty(fixture.card.mounted[0], 'protectConsumed', { value, enumerable: true });
    assert.equal(prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef)).ok, true);
  }
  for (const descriptor of [
    { enumerable: true, get() { unselectedReads += 1; return false; } },
    { enumerable: false, value: false }
  ]) {
    const fixture = restFixture({ cardChanges: { id: 'STD-101', text: '' }, mountedProviderIds: ['STD-080'], stateChanges: { securityRestWindow: 'player' } });
    Object.defineProperty(fixture.card.mounted[0], 'protectConsumed', { configurable: true, ...descriptor });
    code(prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef)), 'INVALID_AUTHORITY');
  }
  const invalidProvider = restFixture({ cardChanges: { id: 'STD-101', text: '' }, mountedProviderIds: ['STD-080'], stateChanges: { securityRestWindow: 'player' } });
  invalidProvider.card.mounted[0].protectConsumed = 'false';
  code(prepareRuntimeCommand(invalidProvider.authority, contextFor(), restCommand(invalidProvider.cardRef)), 'INVALID_AUTHORITY');
  assert.equal(unselectedReads, 0);
});

test('S03-CBR-29: reference reflection exceptions propagate without accessors being invoked', () => {
  const fixture = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const failure = new Error('reference reflection');
  const hostile = new Proxy(fixture.authority.referenceState, { getPrototypeOf() { throw failure; } });
  fixture.authority.referenceState = hostile;
  assert.throws(() => prepareRuntimeCommand(fixture.authority, contextFor(), restCommand(fixture.cardRef)), error => error === failure);
  const selected = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const proxiedCard = new Proxy(selected.card, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'category') throw failure;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  selected.authority.engineState.players.player.front[0] = proxiedCard;
  assert.throws(() => prepareRuntimeCommand(selected.authority, contextFor(), restCommand(selected.cardRef)), error => error === failure);
});

test('S03-CBR-30: same identity token is never substituted for the caller reference token', () => {
  const fixture = restFixture({ stateChanges: { securityRestWindow: 'player' } });
  const command = restCommand('i:1');
  code(prepareRuntimeCommand(fixture.authority, contextFor(), command), 'INVALID_COMMAND');
  assert.equal(fixture.authority.engineState.players.player.front[0].uid, 'rt:i:1');
});

test('S03-CBR-31: prepares an install descriptor from the actor hand without executing it', () => {
  for (const id of ['STD-001', 'STD-224']) {
    const fixture = installFixture({ id });
    const before = JSON.stringify(fixture.authority);
    const command = installCommand(fixture.cardRef);
    const result = prepareRuntimeCommand(fixture.authority, contextFor(), command);
    assert.deepEqual(result, { ok: true, value: {
      kind: 'prepared', command,
      canonicalPayload: `{"action":{"cardRef":"${fixture.cardRef}","type":"install"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`,
      adapter: { engineFunction: 'installCard', playerId: 'player', uid: fixture.card.uid }
    } });
    assert.equal(JSON.stringify(fixture.authority), before);
    assert.equal(fixture.authority.engineState.players.player.hand.length, 1);
    assert.equal(fixture.authority.engineState.players.player.registry.length, 0);
    assert.equal(fixture.authority.engineState.prompt, null);
  }
});

test('S03-CBR-32: install follows hand control rather than card ownership for both seats', () => {
  const foreign = installFixture({ owner: 'ai' });
  assert.deepEqual(prepareRuntimeCommand(foreign.authority, contextFor(), installCommand(foreign.cardRef)).value.adapter,
    { engineFunction: 'installCard', playerId: 'player', uid: foreign.card.uid });
  const ai = installFixture({ owner: 'player', controller: 'ai' });
  const command = installCommand(ai.cardRef, { actorSeat: ai.actorSeat });
  assert.deepEqual(prepareRuntimeCommand(ai.authority, contextFor(ai.actorSeat), command).value.adapter,
    { engineFunction: 'installCard', playerId: 'ai', uid: ai.card.uid });
});

test('S03-CBR-33: registry operation entitlement is checked before reading the private reference table', () => {
  const used = installFixture({ playerChanges: { registryActionUsed: true } });
  let refReads = 0;
  Object.defineProperty(used.authority, 'referenceState', {
    enumerable: true, configurable: true, get() { refReads += 1; throw new Error('reference must remain unread'); }
  });
  code(prepareRuntimeCommand(used.authority, contextFor(), installCommand(used.cardRef)), 'ACTION_NOT_ALLOWED');
  assert.equal(refReads, 0);

  const bonus = installFixture({ playerChanges: { installedThisTurn: true, registryActionUsed: false } });
  assert.equal(prepareRuntimeCommand(bonus.authority, contextFor(), installCommand(bonus.cardRef)).ok, true);
  for (const value of [null, undefined, 0, 'false']) {
    const invalid = installFixture({ playerChanges: { registryActionUsed: value } });
    code(prepareRuntimeCommand(invalid.authority, contextFor(), installCommand(invalid.cardRef)), 'INVALID_AUTHORITY');
  }
  const accessor = installFixture();
  let getterCalls = 0;
  Object.defineProperty(accessor.authority.engineState.players.player, 'registryActionUsed', {
    enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error('must not invoke'); }
  });
  code(prepareRuntimeCommand(accessor.authority, contextFor(), installCommand(accessor.cardRef)), 'INVALID_AUTHORITY');
  assert.equal(getterCalls, 0);
});

test('S03-CBR-34: exact install retry returns before player capability and reference reads', () => {
  const fixture = installFixture();
  const command = installCommand(fixture.cardRef);
  const recorded = recordTerminal(fixture.authority.journal, contextFor(), command, accepted);
  assert.equal(recorded.ok, true);
  fixture.authority.journal = recorded.value;
  let reads = 0;
  Object.defineProperty(fixture.authority, 'referenceState', {
    enumerable: true, configurable: true, get() { reads += 1; throw new Error('reference must remain unread'); }
  });
  Object.defineProperty(fixture.authority.engineState.players.player, 'registryActionUsed', {
    enumerable: true, configurable: true, get() { reads += 1; throw new Error('capability must remain unread'); }
  });
  const retry = prepareRuntimeCommand(fixture.authority, contextFor(), command);
  assert.equal(retry.ok, true);
  assert.equal(retry.value.kind, 'retry');
  assert.deepEqual(retry.value.receipt, { matchId: 'match-a', commandId: 'command-a', status: 'accepted', revision: 1, reasonCode: 'ACCEPTED' });
  assert.equal(reads, 0);
});

test('S03-CBR-35: install accepts only the current actor-controlled hand reference', () => {
  const deck = installFixture();
  deck.authority.engineState.players.player.hand.length = 0;
  deck.authority.engineState.players.player.deck.push(deck.card);
  code(prepareRuntimeCommand(deck.authority, contextFor(), installCommand(deck.cardRef)), 'ACTION_NOT_ALLOWED');

  const registry = installFixture();
  registry.authority.engineState.players.player.hand.length = 0;
  registry.authority.engineState.players.player.registry.push(registry.card);
  code(prepareRuntimeCommand(registry.authority, contextFor(), installCommand(registry.cardRef)), 'ACTION_NOT_ALLOWED');

  const unknown = installFixture();
  code(prepareRuntimeCommand(unknown.authority, contextFor(), installCommand(`r:${'f'.repeat(32)}`)), 'ACTION_NOT_ALLOWED');

  const opponent = installFixture({ active: 'ai' });
  assert.equal(opponent.authority.engineState.active, 'ai');
  const opponentCommand = installCommand(opponent.cardRef, { actorSeat: 'seat-b' });
  code(prepareRuntimeCommand(opponent.authority, contextFor('seat-b'), opponentCommand), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-36: install keeps authority exact and accepts frozen plain data without exposing force', () => {
  const missing = installFixture();
  delete missing.authority.referenceState;
  code(prepareRuntimeCommand(missing.authority, contextFor(), installCommand(missing.cardRef)), 'INVALID_AUTHORITY');

  const frozen = installFixture({ cardChanges: { faceDown: true } });
  const command = deepFreeze(installCommand(frozen.cardRef));
  deepFreeze(frozen.authority);
  const result = prepareRuntimeCommand(frozen.authority, contextFor(), command);
  assert.equal(result.ok, true);
  assert.deepEqual(Reflect.ownKeys(result.value.adapter), ['engineFunction', 'playerId', 'uid']);
  assert.equal(Object.hasOwn(result.value.adapter, 'force'), false);
});

test('S03-CBR-37: prepares recoverRegistry for public registry roots without executing it', () => {
  for (const id of ['STD-001', 'STD-224']) {
    const fixture = installFixture({ id, zone: 'registry' });
    const before = JSON.stringify(fixture.authority);
    const command = recoverCommand(fixture.cardRef);
    const result = prepareRuntimeCommand(fixture.authority, contextFor(), command);
    assert.deepEqual(result, { ok: true, value: {
      kind: 'prepared', command,
      canonicalPayload: `{"action":{"cardRef":"${fixture.cardRef}","type":"recoverRegistry"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`,
      adapter: { engineFunction: 'recoverRegistryCard', playerId: 'player', uid: fixture.card.uid }
    } });
    assert.equal(JSON.stringify(fixture.authority), before);
    assert.equal(fixture.authority.engineState.players.player.registry.length, 1);
    assert.equal(fixture.authority.engineState.players.player.hand.length, 0);
    assert.equal(fixture.authority.engineState.players.player.registryActionUsed, false);
  }
});

test('S03-CBR-38: recoverRegistry follows registry control rather than ownership for both seats', () => {
  const foreign = installFixture({ owner: 'ai', zone: 'registry' });
  assert.deepEqual(prepareRuntimeCommand(foreign.authority, contextFor(), recoverCommand(foreign.cardRef)).value.adapter,
    { engineFunction: 'recoverRegistryCard', playerId: 'player', uid: foreign.card.uid });
  const ai = installFixture({ owner: 'player', controller: 'ai', zone: 'registry' });
  const command = recoverCommand(ai.cardRef, { actorSeat: ai.actorSeat });
  assert.deepEqual(prepareRuntimeCommand(ai.authority, contextFor(ai.actorSeat), command).value.adapter,
    { engineFunction: 'recoverRegistryCard', playerId: 'ai', uid: ai.card.uid });
});

test('S03-CBR-39: recoverRegistry entitlement and exact retry precede reference reads', () => {
  const used = installFixture({ zone: 'registry', playerChanges: { registryActionUsed: true } });
  let reads = 0;
  Object.defineProperty(used.authority, 'referenceState', {
    enumerable: true, configurable: true, get() { reads += 1; throw new Error('reference must remain unread'); }
  });
  code(prepareRuntimeCommand(used.authority, contextFor(), recoverCommand(used.cardRef)), 'ACTION_NOT_ALLOWED');
  assert.equal(reads, 0);

  const bonus = installFixture({ zone: 'registry', playerChanges: { installedThisTurn: true, registryActionUsed: false } });
  assert.equal(prepareRuntimeCommand(bonus.authority, contextFor(), recoverCommand(bonus.cardRef)).ok, true);
  for (const value of [null, undefined, 0, 'false']) {
    const invalid = installFixture({ zone: 'registry', playerChanges: { registryActionUsed: value } });
    code(prepareRuntimeCommand(invalid.authority, contextFor(), recoverCommand(invalid.cardRef)), 'INVALID_AUTHORITY');
  }

  const retryFixture = installFixture({ zone: 'registry' });
  const retryCommand = recoverCommand(retryFixture.cardRef);
  retryFixture.authority.journal = recordTerminal(retryFixture.authority.journal, contextFor(), retryCommand, accepted).value;
  Object.defineProperty(retryFixture.authority, 'referenceState', {
    enumerable: true, configurable: true, get() { reads += 1; throw new Error('retry reference must remain unread'); }
  });
  Object.defineProperty(retryFixture.authority.engineState.players.player, 'registryActionUsed', {
    enumerable: true, configurable: true, get() { reads += 1; throw new Error('retry capability must remain unread'); }
  });
  assert.equal(prepareRuntimeCommand(retryFixture.authority, contextFor(), retryCommand).value.kind, 'retry');
  assert.equal(reads, 0);
});

test('S03-CBR-40: recoverRegistry accepts only the current actor-controlled registry reference', () => {
  for (const zone of ['hand', 'trash']) {
    const fixture = installFixture({ zone });
    code(prepareRuntimeCommand(fixture.authority, contextFor(), recoverCommand(fixture.cardRef)), 'ACTION_NOT_ALLOWED');
  }
  const unknown = installFixture({ zone: 'registry' });
  code(prepareRuntimeCommand(unknown.authority, contextFor(), recoverCommand(`r:${'a'.repeat(32)}`)), 'ACTION_NOT_ALLOWED');

  const opponent = installFixture({ zone: 'registry', active: 'ai' });
  const opponentRef = opponent.authority.referenceState.entries.find(entry => entry.viewerSeat === 'seat-b'
    && entry.identity.instanceId === opponent.card.identity.instanceId).cardRef;
  assert.equal(opponent.authority.engineState.active, 'ai');
  code(prepareRuntimeCommand(opponent.authority, contextFor('seat-b'),
    recoverCommand(opponentRef, { actorSeat: 'seat-b' })), 'ACTION_NOT_ALLOWED');

  const hidden = installFixture({ zone: 'registry' });
  hidden.card.faceDown = true;
  code(prepareRuntimeCommand(hidden.authority, contextFor(), recoverCommand(hidden.cardRef)), 'ACTION_NOT_ALLOWED');
  const malformed = installFixture({ zone: 'registry' });
  malformed.card.faceDown = 'false';
  code(prepareRuntimeCommand(malformed.authority, contextFor(), recoverCommand(malformed.cardRef)), 'INVALID_AUTHORITY');
});

test('S03-CBR-41: recoverRegistry keeps exact authority and frozen inputs without force', () => {
  const missing = installFixture({ zone: 'registry' });
  delete missing.authority.referenceState;
  code(prepareRuntimeCommand(missing.authority, contextFor(), recoverCommand(missing.cardRef)), 'INVALID_AUTHORITY');

  const frozen = installFixture({ zone: 'registry' });
  const command = deepFreeze(recoverCommand(frozen.cardRef));
  deepFreeze(frozen.authority);
  const result = prepareRuntimeCommand(frozen.authority, contextFor(), command);
  assert.equal(result.ok, true);
  assert.deepEqual(Reflect.ownKeys(result.value.adapter), ['engineFunction', 'playerId', 'uid']);
  assert.equal(Object.hasOwn(result.value.adapter, 'force'), false);
});

test('S03-CBR-42: activateScript prepares only an eligible hidden back root without executing', () => {
  const fixture = installFixture({
    id: 'STD-121', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0 }
  });
  const command = activateScriptCommand(fixture.cardRef);
  const before = JSON.stringify(fixture.authority);
  const commandBefore = structuredClone(command);
  const result = prepareRuntimeCommand(fixture.authority, contextFor(), command);
  assert.deepEqual(result, { ok: true, value: {
    kind: 'prepared', command: commandBefore,
    canonicalPayload: `{"action":{"cardRef":"${fixture.cardRef}","type":"activateScript"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`,
    adapter: { engineFunction: 'activateScript', playerId: 'player', uid: fixture.card.uid }
  } });
  assert.equal(JSON.stringify(fixture.authority), before);
  assert.equal(fixture.card.faceDown, true);
  assert.equal(fixture.authority.engineState.players.player.back.includes(fixture.card), true);

  const denied = (options, expected = 'ACTION_NOT_ALLOWED') => {
    const blocked = installFixture({ id: 'STD-121', zone: 'back', ...options });
    code(prepareRuntimeCommand(blocked.authority, contextFor(), activateScriptCommand(blocked.cardRef)), expected);
  };
  denied({ cardChanges: { faceDown: false, color: null, cost: 0 } });
  denied({ cardChanges: { faceDown: true, category: 'Ob', color: null, cost: 0 } });
  denied({ cardChanges: { faceDown: true, declaredEffectId: 'declared-1', color: null, cost: 0 } });
  denied({ cardChanges: { faceDown: true, cannotActivateTurn: 1, color: null, cost: 0 } });
  denied({ cardChanges: { faceDown: true, activationCost: 2, color: null }, playerChanges: { memory: 1 } });
  denied({ cardChanges: { faceDown: true, color: '青', cost: 0 }, playerChanges: { memory: 20 } });
  denied({ cardChanges: { faceDown: true, color: null, cost: 0 }, stateChanges: { pending: { type: 'blocked' } } });
  denied({ id: 'STD-121', zone: 'hand', cardChanges: { faceDown: true, color: null, cost: 0 } });

  const retryFixture = installFixture({
    id: 'STD-121', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0 }
  });
  const retryCommand = activateScriptCommand(retryFixture.cardRef);
  retryFixture.authority.journal = recordTerminal(retryFixture.authority.journal, contextFor(), retryCommand, accepted).value;
  let referenceReads = 0;
  Object.defineProperty(retryFixture.authority, 'referenceState', {
    enumerable: true, configurable: true,
    get() { referenceReads += 1; throw new Error('retry must precede reference validation'); }
  });
  const retry = prepareRuntimeCommand(retryFixture.authority, contextFor(), retryCommand);
  assert.equal(retry.ok, true);
  assert.equal(retry.value.kind, 'retry');
  assert.equal(referenceReads, 0);
});

test('S03-CBR-43: activateScript excludes optional scripts and validates cost fallback and declared state', () => {
  const optional = installFixture({ id: 'STD-105', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0 } });
  code(prepareRuntimeCommand(optional.authority, contextFor(), activateScriptCommand(optional.cardRef)), 'ACTION_NOT_ALLOWED');

  for (const cardChanges of [
    { faceDown: true, color: null, cost: 1 },
    { faceDown: true, color: null, cost: 1, activationCost: null },
    { faceDown: true, color: null, cost: 1, activationCost: undefined }
  ]) {
    const fallback = installFixture({ id: 'STD-121', zone: 'back', cardChanges, playerChanges: { memory: 0 } });
    code(prepareRuntimeCommand(fallback.authority, contextFor(), activateScriptCommand(fallback.cardRef)), 'ACTION_NOT_ALLOWED');
  }
  for (const activationCost of [-1, -0, '1', Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = installFixture({ id: 'STD-121', zone: 'back',
      cardChanges: { faceDown: true, color: null, cost: 0, activationCost } });
    code(prepareRuntimeCommand(invalid.authority, contextFor(), activateScriptCommand(invalid.cardRef)), 'INVALID_AUTHORITY');
  }
  const declaredUndefined = installFixture({ id: 'STD-121', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0, declaredEffectId: undefined } });
  code(prepareRuntimeCommand(declaredUndefined.authority, contextFor(), activateScriptCommand(declaredUndefined.cardRef)), 'INVALID_AUTHORITY');
});

test('S03-CBR-44: activation requires a real color symbol except in lab and ignores Plugin-only color', () => {
  const colored = { faceDown: true, color: '青', cost: 0, activationCost: 0 };
  const symbol = installFixture({ id: 'STD-121', zone: 'back', cardChanges: colored,
    playerChanges: { memory: 10 }, registryCards: [{ id: 'STD-121', cardChanges: { faceDown: false } }] });
  assert.equal(prepareRuntimeCommand(symbol.authority, contextFor(), activateScriptCommand(symbol.cardRef)).ok, true);

  const pluginOnly = installFixture({ id: 'STD-121', zone: 'back', cardChanges: colored,
    playerChanges: { memory: 10 }, registryCards: [{ id: 'STD-121', cardChanges: { faceDown: false, category: 'Plugin' } }] });
  code(prepareRuntimeCommand(pluginOnly.authority, contextFor(), activateScriptCommand(pluginOnly.cardRef)), 'ACTION_NOT_ALLOWED');

  const lab = installFixture({ id: 'STD-121', zone: 'back', cardChanges: colored, mode: 'lab', playerChanges: { memory: 10 } });
  assert.equal(prepareRuntimeCommand(lab.authority, contextFor(), activateScriptCommand(lab.cardRef)).ok, true);
});

test('S03-CBR-45: activateScript follows AI control even when another seat owns the card', () => {
  const fixture = installFixture({ id: 'STD-121', owner: 'player', controller: 'ai', active: 'ai', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0 } });
  const command = activateScriptCommand(fixture.cardRef, { actorSeat: 'seat-b' });
  const result = prepareRuntimeCommand(fixture.authority, contextFor('seat-b'), command);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.adapter, { engineFunction: 'activateScript', playerId: 'ai', uid: fixture.card.uid });
  assert.equal(fixture.card.ownerSeat, 'seat-a');
  assert.equal(fixture.authority.engineState.players.ai.back.includes(fixture.card), true);
});

test('S03-CBR-46: opponent-controlled script is rejected before selected private card fields', () => {
  const fixture = installFixture({ id: 'STD-121', owner: 'player', controller: 'ai', active: 'player', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0 } });
  const actorRef = fixture.authority.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === fixture.card.identity.instanceId).cardRef;
  let getterCalls = 0;
  Object.defineProperty(fixture.card, 'activationCost', {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; throw new Error('opponent private card must not be inspected'); }
  });
  code(prepareRuntimeCommand(fixture.authority, contextFor(), activateScriptCommand(actorRef)), 'ACTION_NOT_ALLOWED');
  assert.equal(getterCalls, 0);
});

test('S03-CBR-47: activateScript selected accessors stay uncalled and frozen inputs remain preparable', () => {
  const accessor = installFixture({ id: 'STD-121', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0 } });
  let getterCalls = 0;
  Object.defineProperty(accessor.card, 'activationCost', {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return 0; }
  });
  code(prepareRuntimeCommand(accessor.authority, contextFor(), activateScriptCommand(accessor.cardRef)), 'INVALID_AUTHORITY');
  assert.equal(getterCalls, 0);

  const frozen = installFixture({ id: 'STD-121', zone: 'back',
    cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0 } });
  const command = deepFreeze(activateScriptCommand(frozen.cardRef));
  deepFreeze(frozen.authority);
  const result = prepareRuntimeCommand(frozen.authority, contextFor(), command);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.adapter, { engineFunction: 'activateScript', playerId: 'player', uid: frozen.card.uid });
});

test('S03-CBR-48: activateScript follows the engine normal-IF capability without opening event windows', () => {
  assert.equal(supportsNormalScriptActivation({ id: 'TEST-IF', category: 'Script', text: '[if:test]' }), false);
  assert.equal(supportsNormalScriptActivation({ id: 'TEST-PLAIN', category: 'Ob', text: '' }), false);
  const normalIfIds = ['STD-001', 'STD-002', 'STD-003', 'STD-036', 'STD-037', 'STD-139', 'STD-140', 'STD-148'];
  for (const id of normalIfIds) {
    const fixture = installFixture({ id, zone: 'back',
      cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0 },
      playerChanges: { memory: 20 } });
    const before = JSON.stringify(fixture.authority);
    const result = prepareRuntimeCommand(fixture.authority, contextFor(), activateScriptCommand(fixture.cardRef));
    assert.equal(result.ok, true, `${id} should use the engine normal-activation route`);
    assert.deepEqual(result.value.adapter,
      { engineFunction: 'activateScript', playerId: 'player', uid: fixture.card.uid });
    assert.equal(JSON.stringify(fixture.authority), before, `${id} preparation must not execute the Script`);
  }

  for (const id of ['STD-018', 'STD-019', 'STD-038', 'STD-204']) {
    const fixture = installFixture({ id, zone: 'back',
      cardChanges: { faceDown: true, color: null, cost: 0, activationCost: 0 },
      playerChanges: { memory: 20 } });
    code(prepareRuntimeCommand(fixture.authority, contextFor(), activateScriptCommand(fixture.cardRef)),
      'ACTION_NOT_ALLOWED');
  }
});

test('S03-CBR-49: executeCard prepares the shared trial Ob route without executing it', () => {
  for (const id of ['STD-020', 'STD-021', 'STD-022', 'STD-023', 'STD-024']) {
    for (const zone of ['front', 'back']) {
      const fixture = installFixture({ id, cardChanges: { color: null }, playerChanges: { memory: 20 } });
      const command = executeCardCommand(fixture.cardRef, zone, 5);
      const before = JSON.stringify(fixture.authority);
      const result = prepareRuntimeCommand(fixture.authority, contextFor(), command);
      assert.equal(result.ok, true, `${id}/${zone}`);
      assert.deepEqual(result.value.adapter, {
        engineFunction: 'playCard', playerId: 'player', uid: fixture.card.uid,
        options: { zone, requestedSlot: 5 }
      });
      assert.equal(JSON.stringify(fixture.authority), before);
      assert.equal(fixture.authority.engineState.players.player.hand.includes(fixture.card), true);
    }
  }
});

test('S03-CBR-50: executeCard rejects stale location, controller, unsupported cards and illegal slots', () => {
  for (const id of ['STD-001']) {
    const unsupported = installFixture({ id, cardChanges: { color: null }, playerChanges: { memory: 20 } });
    code(prepareRuntimeCommand(unsupported.authority, contextFor(),
      executeCardCommand(unsupported.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
  }
  for (const id of ['STD-125','STD-184']) {
    const legal = installFixture({id,cardChanges:{color:null},playerChanges:{memory:20}});
    const before = JSON.stringify(legal.authority);
    const prepared = prepareRuntimeCommand(legal.authority,contextFor(),executeCardCommand(legal.cardRef,'front',5));
    assert.equal(prepared.ok,true,JSON.stringify(prepared));
    assert.deepEqual(prepared.value.adapter,{engineFunction:'playCard',playerId:'player',uid:legal.card.uid,options:{zone:'front',requestedSlot:5}});
    assert.equal(JSON.stringify(legal.authority),before);
  }
  for (const zone of ['front', 'back', 'trash']) {
    const misplaced = installFixture({ id: 'STD-020', zone, cardChanges: { color: null }, playerChanges: { memory: 20 } });
    code(prepareRuntimeCommand(misplaced.authority, contextFor(),
      executeCardCommand(misplaced.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
  }
  const foreign = installFixture({ id: 'STD-020', owner: 'player', controller: 'ai', active: 'player',
    cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const actorRef = foreign.authority.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === foreign.card.identity.instanceId)?.cardRef;
  if (actorRef) code(prepareRuntimeCommand(foreign.authority, contextFor(),
    executeCardCommand(actorRef, 'front', 5)), 'ACTION_NOT_ALLOWED');

  const occupied = installFixture({ id: 'STD-020', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const blocker = createRuntimeCard(occupied.authority.engineState.runtimeContext, 'STD-021', 'player');
  assert.equal(placeCardInBoardSlot(occupied.authority.engineState.players.player.front, blocker,
    { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 5 }), true);
  code(prepareRuntimeCommand(occupied.authority, contextFor(),
    executeCardCommand(occupied.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
  code(prepareRuntimeCommand(occupied.authority, contextFor(),
    executeCardCommand(occupied.cardRef, 'front', 6)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-51: executeCard revalidates memory, symbols and existing cost modifiers', () => {
  const noMemory = installFixture({ id: 'STD-020', cardChanges: { color: null }, playerChanges: { memory: 0 } });
  code(prepareRuntimeCommand(noMemory.authority, contextFor(),
    executeCardCommand(noMemory.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');

  const noSymbol = installFixture({ id: 'STD-020', cardChanges: { color: '青' }, playerChanges: { memory: 20 } });
  code(prepareRuntimeCommand(noSymbol.authority, contextFor(),
    executeCardCommand(noSymbol.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
  const symbol = installFixture({ id: 'STD-020', cardChanges: { color: '青' }, playerChanges: { memory: 20 },
    registryCards: [{ id: 'STD-121', cardChanges: { color: '青', faceDown: false } }] });
  assert.equal(prepareRuntimeCommand(symbol.authority, contextFor(),
    executeCardCommand(symbol.cardRef, 'front', 5)).ok, true);

  const reduced = installFixture({ id: 'STD-020', cardChanges: { color: null, turnCostModifier: -10 },
    playerChanges: { memory: 0 } });
  assert.equal(prepareRuntimeCommand(reduced.authority, contextFor(),
    executeCardCommand(reduced.cardRef, 'front', 5)).ok, true);
  const increased = installFixture({ id: 'STD-020', cardChanges: { color: null, turnCostModifier: 10 },
    playerChanges: { memory: 5 } });
  code(prepareRuntimeCommand(increased.authority, contextFor(),
    executeCardCommand(increased.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-52: executeCard exact retry precedes reference reads and frozen data stays preparable', () => {
  const retryFixture = installFixture({ id: 'STD-020', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const retryCommand = executeCardCommand(retryFixture.cardRef, 'back', 5);
  retryFixture.authority.journal = recordTerminal(retryFixture.authority.journal, contextFor(), retryCommand, accepted).value;
  let referenceReads = 0;
  Object.defineProperty(retryFixture.authority, 'referenceState', {
    enumerable: true, configurable: true, get() { referenceReads += 1; throw new Error('retry must not read references'); }
  });
  assert.equal(prepareRuntimeCommand(retryFixture.authority, contextFor(), retryCommand).value.kind, 'retry');
  assert.equal(referenceReads, 0);

  const frozen = installFixture({ id: 'STD-020', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const command = deepFreeze(executeCardCommand(frozen.cardRef, 'front', 5));
  deepFreeze(frozen.authority);
  assert.equal(prepareRuntimeCommand(frozen.authority, contextFor(), command).ok, true);
});

test('S03-CBR-53: executeCard rejects selected accessors without invoking them', () => {
  const fixture = installFixture({ id: 'STD-020', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  let getterCalls = 0;
  Object.defineProperty(fixture.card, 'cost', {
    enumerable: true, configurable: true, get() { getterCalls += 1; return 1; }
  });
  code(prepareRuntimeCommand(fixture.authority, contextFor(),
    executeCardCommand(fixture.cardRef, 'front', 5)), 'INVALID_AUTHORITY');
  assert.equal(getterCalls, 0);
});

test('S03-CBR-54: executeCard preserves AI-seat routing and global cost providers', () => {
  const ai = installFixture({ id: 'STD-020', owner: 'player', controller: 'ai', active: 'ai',
    cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const aiCommand = executeCardCommand(ai.cardRef, 'back', 5, { actorSeat: ai.actorSeat });
  assert.deepEqual(prepareRuntimeCommand(ai.authority, contextFor(ai.actorSeat), aiCommand).value.adapter, {
    engineFunction: 'playCard', playerId: 'ai', uid: ai.card.uid,
    options: { zone: 'back', requestedSlot: 5 }
  });

  const discount = installFixture({ id: 'STD-020', cardChanges: { color: null, cost: 2 },
    playerChanges: { memory: 1 }, registryCards: [{ id: 'STD-007', cardChanges: { faceDown: false } }] });
  const prior = createRuntimeCard(discount.authority.engineState.runtimeContext, 'STD-021', 'player');
  prior.name = discount.card.name;
  prior.faceDown = true;
  discount.authority.engineState.players.player.trash.push(prior);
  assert.equal(prepareRuntimeCommand(discount.authority, contextFor(),
    executeCardCommand(discount.cardRef, 'front', 5)).ok, true);

  const surcharge = installFixture({ id: 'STD-020', cardChanges: { color: null, cost: 1 },
    playerChanges: { memory: 1 } });
  const blocker = createRuntimeCard(surcharge.authority.engineState.runtimeContext, 'STD-008', 'ai');
  blocker.faceDown = false;
  assert.equal(placeCardInBoardSlot(surcharge.authority.engineState.players.ai.front, blocker,
    { controllerId: 'ai', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  code(prepareRuntimeCommand(surcharge.authority, contextFor(),
    executeCardCommand(surcharge.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-55: executeCard counts printed Ob in the do_or_isnt first-execution boundary', () => {
  const fixture = (count) => {
    const result = installFixture({ id: 'STD-020', cardChanges: { color: null, cost: 1 },
      playerChanges: { memory: 0 } });
    result.authority.engineState.players.player.user.abilityKey = 'do_or_isnt';
    for (let index = 0; index < count; index += 1) {
      const transformed = createRuntimeCard(result.authority.engineState.runtimeContext, 'STD-021', 'player');
      transformed.category = 'Code';
      transformed.printedCategory = 'Ob';
      assert.equal(placeCardInBoardSlot(result.authority.engineState.players.player.front, transformed,
        { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: index + 1 }), true);
    }
    return result;
  };
  const two = fixture(2);
  assert.equal(prepareRuntimeCommand(two.authority, contextFor(),
    executeCardCommand(two.cardRef, 'back', 5)).ok, true);
  const three = fixture(3);
  code(prepareRuntimeCommand(three.authority, contextFor(),
    executeCardCommand(three.cardRef, 'back', 5)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-56: executeCard prepares ordinary and Login Ob for both seats without resolving Login', () => {
  for (const id of ['STD-027', 'STD-030']) {
    for (const zone of ['front', 'back']) {
      const fixture = installFixture({ id, cardChanges: { color: null }, playerChanges: { memory: 20 } });
      const before = JSON.stringify(fixture.authority);
      const result = prepareRuntimeCommand(fixture.authority, contextFor(), executeCardCommand(fixture.cardRef, zone, 5));
      assert.equal(result.ok, true, `${id}/${zone}`);
      assert.deepEqual(result.value.adapter, {
        engineFunction: 'playCard', playerId: 'player', uid: fixture.card.uid,
        options: { zone, requestedSlot: 5 }
      });
      assert.equal(JSON.stringify(fixture.authority), before);
      assert.equal(fixture.authority.engineState.pending, null);
    }
  }

  const ai = installFixture({ id: 'STD-027', owner: 'player', controller: 'ai', active: 'ai',
    cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const result = prepareRuntimeCommand(ai.authority, contextFor(ai.actorSeat),
    executeCardCommand(ai.cardRef, 'back', 5, { actorSeat: ai.actorSeat }));
  assert.deepEqual(result.value.adapter, {
    engineFunction: 'playCard', playerId: 'ai', uid: ai.card.uid,
    options: { zone: 'back', requestedSlot: 5 }
  });
});

test('S03-CBR-57: executeCard preserves shared execution and placement restrictions', () => {
  const forbidden = installFixture({ id: 'STD-088', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  for (const zone of ['front', 'back']) code(prepareRuntimeCommand(forbidden.authority, contextFor(),
    executeCardCommand(forbidden.cardRef, zone, 5)), 'ACTION_NOT_ALLOWED');

  const front = installFixture({ id: 'STD-193', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  code(prepareRuntimeCommand(front.authority, contextFor(),
    executeCardCommand(front.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
  assert.equal(prepareRuntimeCommand(front.authority, contextFor(),
    executeCardCommand(front.cardRef, 'back', 5)).ok, true);
});

test('S03-CBR-58: executeCard preserves STD-100 distinct-name class cost reduction', () => {
  const fixture = (names) => {
    const result = installFixture({ id: 'STD-100', cardChanges: { color: null }, playerChanges: { memory: 10 } });
    for (const [index, name] of names.entries()) {
      const provider = createRuntimeCard(result.authority.engineState.runtimeContext, 'STD-093', 'player');
      provider.name = name;
      provider.classes = ['レッドパンクス'];
      provider.faceDown = false;
      assert.equal(placeCardInBoardSlot(result.authority.engineState.players.player.front, provider,
        { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: index + 1 }), true);
    }
    return result;
  };
  const distinct = fixture(['応援団A', '応援団B']);
  assert.equal(prepareRuntimeCommand(distinct.authority, contextFor(),
    executeCardCommand(distinct.cardRef, 'back', 5)).ok, true);
  const duplicate = fixture(['応援団A', '応援団A']);
  code(prepareRuntimeCommand(duplicate.authority, contextFor(),
    executeCardCommand(duplicate.cardRef, 'back', 5)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-59: executeCard preserves Layered/wrong-zone/cost negatives while preparing legal OC and terminal cost', () => {
  for (const id of ['STD-085', 'STD-121']) {
    const fixture = installFixture({ id, cardChanges: { color: null }, playerChanges: { memory: 20 } });
    code(prepareRuntimeCommand(fixture.authority, contextFor(),
      executeCardCommand(fixture.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');
  }
  const missing = installFixture({id:'STD-121',cardChanges:{color:null},playerChanges:{memory:20}});
  code(prepareRuntimeCommand(missing.authority,contextFor(),executeCardCommand(missing.cardRef,'back',1)),'ACTION_NOT_ALLOWED');
  const zero = installFixture({ id: 'STD-027', cardChanges: { color: null, text: '[OC+0]' },
    playerChanges: { memory: 20 } });
  const oc = installFixture({id:'STD-125',cardChanges:{color:null},playerChanges:{memory:20}});
  const terminal = installFixture({id:'STD-121',cardChanges:{color:null},playerChanges:{memory:20}});
  for (const [index,id] of ['STD-118','STD-119','STD-120'].entries()) {
    const card = createRuntimeCard(terminal.authority.engineState.runtimeContext,id,'player');
    card.faceDown = false;
    assert.equal(placeCardInBoardSlot(terminal.authority.engineState.players.player.back,card,
      {controllerId:'player',zoneName:'back',limit:5,requestedSlot:index+1}),true);
  }
  for (const [fixture,zone,slot] of [[zero,'front',5],[oc,'front',5],[terminal,'back',1]]) {
    const before = JSON.stringify(fixture.authority);
    const prepared = prepareRuntimeCommand(fixture.authority,contextFor(),executeCardCommand(fixture.cardRef,zone,slot));
    assert.equal(prepared.ok,true,JSON.stringify(prepared));
    assert.deepEqual(prepared.value.adapter,{engineFunction:'playCard',playerId:'player',uid:fixture.card.uid,options:{zone,requestedSlot:slot}});
    assert.equal(JSON.stringify(fixture.authority),before);
  }
});

test('S03-CBR-60: executeCard rejects text and provider-class accessors without invoking them', () => {
  const selected = installFixture({ id: 'STD-027', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  let textReads = 0;
  Object.defineProperty(selected.card, 'text', {
    enumerable: true, configurable: true, get() { textReads += 1; return ''; }
  });
  code(prepareRuntimeCommand(selected.authority, contextFor(),
    executeCardCommand(selected.cardRef, 'front', 5)), 'INVALID_AUTHORITY');
  assert.equal(textReads, 0);

  const providerFixture = installFixture({ id: 'STD-027', cardChanges: { color: null }, playerChanges: { memory: 20 } });
  const provider = createRuntimeCard(providerFixture.authority.engineState.runtimeContext, 'STD-093', 'player');
  assert.equal(placeCardInBoardSlot(providerFixture.authority.engineState.players.player.front, provider,
    { controllerId: 'player', zoneName: 'front', limit: 5, requestedSlot: 1 }), true);
  let classReads = 0;
  Object.defineProperty(provider, 'classes', {
    enumerable: true, configurable: true, get() { classReads += 1; return ['レッドパンクス']; }
  });
  code(prepareRuntimeCommand(providerFixture.authority, contextFor(),
    executeCardCommand(providerFixture.cardRef, 'front', 5)), 'INVALID_AUTHORITY');
  assert.equal(classReads, 0);
});

test('S03-CBR-61: redeploy prepares ordinary board Ob to the opposite explicit slot for both seats', () => {
  for (const [source, destination] of [['front', 'back'], ['back', 'front']]) {
    const fixture = installFixture({ id: 'STD-027', zone: source, owner: 'ai', controller: 'player',
      cardChanges: { color: '青' }, playerChanges: { memory: 3 } });
    const before = JSON.stringify(fixture.authority);
    const result = prepareRuntimeCommand(fixture.authority, contextFor(),
      redeployCommand(fixture.cardRef, destination, 5));
    assert.equal(result.ok, true, `${source}->${destination}`);
    assert.deepEqual(result.value.adapter, {
      engineFunction: 'relogCard', playerId: 'player', uid: fixture.card.uid,
      targetZone: destination, options: { requestedSlot: 5 }
    });
    assert.equal(JSON.stringify(fixture.authority), before);
  }

  const ai = installFixture({ id: 'STD-027', zone: 'front', owner: 'player', controller: 'ai', active: 'ai',
    playerChanges: { memory: 3 } });
  const result = prepareRuntimeCommand(ai.authority, contextFor(ai.actorSeat),
    redeployCommand(ai.cardRef, 'back', 5, { actorSeat: ai.actorSeat }));
  assert.equal(result.ok, true);
  assert.equal(result.value.adapter.playerId, 'ai');
});

test('S03-CBR-62: redeploy uses printed move cost and ignores execution-only modifiers and symbols', () => {
  const enough = installFixture({ id: 'STD-027', zone: 'front',
    cardChanges: { color: '青', turnCostModifier: 50, costReductionThisTurn: 0 }, playerChanges: { memory: 3 } });
  assert.equal(prepareRuntimeCommand(enough.authority, contextFor(),
    redeployCommand(enough.cardRef, 'back', 5)).ok, true);

  const short = installFixture({ id: 'STD-027', zone: 'front',
    cardChanges: { color: null, turnCostModifier: -50, costReductionThisTurn: 50 }, playerChanges: { memory: 2 } });
  code(prepareRuntimeCommand(short.authority, contextFor(),
    redeployCommand(short.cardRef, 'back', 5)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-63: redeploy rejects same-zone, occupied, nonroot and non-Ob sources', () => {
  const same = installFixture({ id: 'STD-027', zone: 'front', playerChanges: { memory: 20 } });
  code(prepareRuntimeCommand(same.authority, contextFor(),
    redeployCommand(same.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');

  const occupied = installFixture({ id: 'STD-027', zone: 'front', playerChanges: { memory: 20 } });
  const blocker = createRuntimeCard(occupied.authority.engineState.runtimeContext, 'STD-021', 'player');
  assert.equal(placeCardInBoardSlot(occupied.authority.engineState.players.player.back, blocker,
    { controllerId: 'player', zoneName: 'back', limit: 5, requestedSlot: 5 }), true);
  code(prepareRuntimeCommand(occupied.authority, contextFor(),
    redeployCommand(occupied.cardRef, 'back', 5)), 'ACTION_NOT_ALLOWED');

  const script = installFixture({ id: 'STD-001', zone: 'back', cardChanges: { faceDown: false },
    playerChanges: { memory: 20 } });
  code(prepareRuntimeCommand(script.authority, contextFor(),
    redeployCommand(script.cardRef, 'front', 5)), 'ACTION_NOT_ALLOWED');

  const mounted = installFixture({ id: 'STD-027', zone: 'front', playerChanges: { memory: 20 },
    mountedCards: [{ id: 'STD-078', cardChanges: { faceDown: false } }] });
  const mountedRef = mounted.authority.referenceState.entries.find(entry => entry.viewerSeat === mounted.actorSeat
    && entry.identity.instanceId === mounted.mounted[0].identity.instanceId).cardRef;
  code(prepareRuntimeCommand(mounted.authority, contextFor(),
    redeployCommand(mountedRef, 'back', 5)), 'ACTION_NOT_ALLOWED');
  assert.equal(prepareRuntimeCommand(mounted.authority, contextFor(),
    redeployCommand(mounted.cardRef, 'back', 5)).ok, true);
});

test('S03-CBR-64: redeploy excludes registry board routes and supports ordinary/layer payment continuations', () => {
  for (const id of ['STD-215', 'STD-220']) {
    const fixture = installFixture({ id, zone: 'front', cardChanges: { color: null }, playerChanges: { memory: 20 } });
    code(prepareRuntimeCommand(fixture.authority, contextFor(),
      redeployCommand(fixture.cardRef, 'back', 5)), 'ACTION_NOT_ALLOWED');
  }

  const plain = installFixture({ id: 'STD-195', zone: 'front', cardChanges: { color: null },
    playerChanges: { memory: 20 } });
  assert.equal(prepareRuntimeCommand(plain.authority, contextFor(),
    redeployCommand(plain.cardRef, 'back', 5)).ok, true);

  for (const discounted of [false, true]) {
    const layered = installFixture({ id: 'STD-195', zone: 'front', cardChanges: { color: null },
      playerChanges: { memory: 20 },
      mountedCards: [{ id: 'STD-020', cardChanges: { faceDown: false, layerRole: 'layered' } }] });
    const before = JSON.stringify(layered.authority), layer = layered.mounted[0];
    const command = redeployCommand(layered.cardRef, 'back', 5);
    const prepared = prepareRuntimeCommand(layered.authority, contextFor(), command);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(prepared.value.adapter, {
      engineFunction: 'relogCard', playerId: 'player', uid: layered.card.uid,
      targetZone: 'back', options: { requestedSlot: 5 }
    });
    assert.equal(JSON.stringify(layered.authority), before);
    const started = submitRuntimeCommand(layered.authority, contextFor(), command);
    assert.equal(started.ok, true, JSON.stringify(started));assert.equal(started.value.kind, 'accepted');
    assert.equal(JSON.stringify(layered.authority), before);
    let authority = started.value.authority;
    const assertUnpaid = () => {
      const player = authority.engineState.players.player;
      assert.equal(player.memory, 20);assert.equal(player.front.length, 1);assert.equal(player.back.length, 0);
      assert.equal(player.front[0].uid, layered.card.uid);assert.equal(player.front[0].mounted.length, 1);
      assert.equal(player.front[0].mounted[0].uid, layer.uid);assert.equal(player.trash.length, 0);
      assert.equal(authority.engineState.pending.request.continuation.requestedSlot, 5);
    };
    assertUnpaid();
    const payment = buildRequiredInput(authority, 'seat-a');
    assert.equal(payment.ok, true);assert.equal(payment.value.canAnswer, true);
    const option = payment.value.options.find(item => item.kind === 'value'
      && item.label === (discounted ? 'レイヤー1枚を破棄して1メモリ' : '通常コストを払う'));
    assert.ok(option);
    const paid = submitRuntimeCommand(authority, contextFor(), baseCommand({commandId:'payment-choice',
      expectedRevision:authority.revision,action:{type:'answerChoice',choiceId:payment.value.choiceId,optionIds:[option.optionId],allocation:[]}}));
    assert.equal(paid.ok, true, JSON.stringify(paid));assert.equal(paid.value.kind, 'accepted');
    authority = paid.value.authority;
    if (discounted) {
      assertUnpaid();
      assert.equal(authority.engineState.pending.request.continuation.type, 'relog-layer-select');
      const selection = buildRequiredInput(authority, 'seat-a');
      assert.equal(selection.ok, true);assert.equal(selection.value.canAnswer, true);
      const layerRef = authority.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
        && entry.identity.instanceId === layer.identity.instanceId).cardRef;
      const selected = selection.value.options.find(item => item.cardRef === layerRef);assert.ok(selected);
      const consumed = submitRuntimeCommand(authority, contextFor(), baseCommand({commandId:'layer-choice',
        expectedRevision:authority.revision,action:{type:'answerChoice',choiceId:selection.value.choiceId,optionIds:[selected.optionId],allocation:[]}}));
      assert.equal(consumed.ok, true, JSON.stringify(consumed));assert.equal(consumed.value.kind, 'accepted');
      authority = consumed.value.authority;
    }
    const player = authority.engineState.players.player;
    assert.equal(player.memory, discounted ? 19 : 16);assert.equal(player.front.length, 0);assert.equal(player.back.length, 1);
    const moved = player.back[0];assert.equal(moved.uid, layered.card.uid);assert.equal(moved.boardSlot, 5);
    assert.equal(moved.sleep, false);assert.equal(moved.summoningSick, false);
    assert.equal(moved.mounted.length, discounted ? 0 : 1);
    if (!discounted) assert.equal(moved.mounted[0].uid, layer.uid);
    assert.deepEqual(player.trash.map(item => item.uid), discounted ? [layer.uid] : []);
    assert.equal(buildRequiredInput(authority, 'seat-a').value, null);
  }
});

test('S03-CBR-65: redeploy retry precedes reference reads and mounted accessors stay uncalled', () => {
  const retry = installFixture({ id: 'STD-027', zone: 'front', playerChanges: { memory: 20 } });
  const command = redeployCommand(retry.cardRef, 'back', 5);
  retry.authority.journal = recordTerminal(retry.authority.journal, contextFor(), command, accepted).value;
  let referenceReads = 0;
  Object.defineProperty(retry.authority, 'referenceState', {
    enumerable: true, configurable: true, get() { referenceReads += 1; throw new Error('retry must not read references'); }
  });
  assert.equal(prepareRuntimeCommand(retry.authority, contextFor(), command).value.kind, 'retry');
  assert.equal(referenceReads, 0);

  const accessor = installFixture({ id: 'STD-027', zone: 'front', playerChanges: { memory: 20 } });
  let mountedReads = 0;
  Object.defineProperty(accessor.card, 'mounted', {
    enumerable: true, configurable: true, get() { mountedReads += 1; return []; }
  });
  code(prepareRuntimeCommand(accessor.authority, contextFor(),
    redeployCommand(accessor.cardRef, 'back', 5)), 'INVALID_AUTHORITY');
  assert.equal(mountedReads, 0);
});

test('S03-CBR-66: openingMulligan prepares the shared engine action for either active seat without mutation', () => {
  for (const active of ['player', 'ai']) {
    for (const mulligansUsed of [0, 1, 2]) {
      const fixture = mulliganFixture({ active, mulligansUsed });
      const before = JSON.stringify(fixture.authority);
      const result = prepareRuntimeCommand(fixture.authority, contextFor(fixture.actorSeat), fixture.command);
      assert.equal(result.ok, true, `${active}:${mulligansUsed}`);
      assert.deepEqual(result.value.adapter, { engineFunction: 'openingMulligan', playerId: active });
      assert.equal(JSON.stringify(fixture.authority), before);
    }
  }
});

test('S03-CBR-67: openingMulligan rejects ineligible ability, turn, use count, hand and occupied zones', () => {
  for (const fixture of [
    mulliganFixture({ abilityKey: 'turbo_boost' }),
    mulliganFixture({ turnNumber: 2 }),
    mulliganFixture({ mulligansUsed: 3 }),
    mulliganFixture({ handCount: 4 }),
    ...['front', 'back', 'registry', 'trash', 'ban'].map(occupiedZone => mulliganFixture({ occupiedZone }))
  ]) code(prepareRuntimeCommand(fixture.authority, contextFor(fixture.actorSeat), fixture.command), 'ACTION_NOT_ALLOWED');

  const offTurn = mulliganFixture();
  code(prepareRuntimeCommand(offTurn.authority, contextFor('seat-b'),
    openingMulliganCommand({ actorSeat: 'seat-b' })), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-68: openingMulligan accepts nullish initial hand default and rejects malformed planning data', () => {
  const nullHand = mulliganFixture({ initialHand: null, handCount: 5 });
  assert.equal(prepareRuntimeCommand(nullHand.authority, contextFor(), nullHand.command).ok, true);
  const undefinedHand = mulliganFixture({ handCount: 5 });
  undefinedHand.authority.engineState.players.player.user.initialHand = undefined;
  assert.equal(prepareRuntimeCommand(undefinedHand.authority, contextFor(), undefinedHand.command).ok, true);
  for (const initialHand of [-0, -1, 1.5, '5']) {
    const fixture = mulliganFixture({ initialHand, handCount: 5 });
    code(prepareRuntimeCommand(fixture.authority, contextFor(), fixture.command), 'INVALID_AUTHORITY');
  }
  const hole = mulliganFixture();
  hole.authority.engineState.players.player.hand = new Array(5);
  code(prepareRuntimeCommand(hole.authority, contextFor(), hole.command), 'INVALID_AUTHORITY');
});

test('S03-CBR-69: openingMulligan retry precedes eligibility reads and accessors never execute', () => {
  const retry = mulliganFixture();
  retry.authority.journal = recordTerminal(retry.authority.journal, contextFor(), retry.command, accepted).value;
  let stateReads = 0;
  Object.defineProperty(retry.authority, 'engineState', {
    enumerable: true, configurable: true, get() { stateReads += 1; throw new Error('retry must not read engine state'); }
  });
  assert.equal(prepareRuntimeCommand(retry.authority, contextFor(), retry.command).value.kind, 'retry');
  assert.equal(stateReads, 0);

  const accessor = mulliganFixture();
  let abilityReads = 0;
  Object.defineProperty(accessor.authority.engineState.players.player.user, 'abilityKey', {
    enumerable: true, configurable: true, get() { abilityReads += 1; return 'watching_you'; }
  });
  code(prepareRuntimeCommand(accessor.authority, contextFor(), accessor.command), 'INVALID_AUTHORITY');
  assert.equal(abilityReads, 0);
});

test('S03-CBR-70: prepares a detached Turbo adapter for either active seat without activating it', () => {
  for (const [playerId, actorSeat] of [['player', 'seat-a'], ['ai', 'seat-b']]) {
    const authority = turboFixture({ active: playerId, aiAbilityKey: playerId === 'ai' ? 'turbo' : 'watching_you' });
    const command = activateTurboCommand({ actorSeat });
    const before = structuredClone(authority);
    const commandBefore = structuredClone(command);
    const result = prepareRuntimeCommand(authority, contextFor(actorSeat), command);
    assert.deepEqual(result, { ok: true, value: {
      kind: 'prepared', command: commandBefore,
      canonicalPayload: `{"action":{"ability":{"key":"turbo","kind":"user"},"type":"activateAbility"},"actorSeat":"${actorSeat}","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`,
      adapter: { engineFunction: 'activateTurbo', playerId }
    } });
    result.value.command.action.ability.key = 'mutated';
    assert.deepEqual(authority, before);
    assert.equal(authority.engineState.players[playerId].turboUsed, false);
    assert.equal(authority.engineState.players[playerId].turboActive, false);
  }
});

test('S03-CBR-71: Turbo preparation rejects wrong ability, used state, inactive seat, and busy state', () => {
  for (const authority of [
    turboFixture({ playerAbilityKey: 'watching_you' }),
    turboFixture({ playerTurboUsed: true }),
    turboFixture({ active: 'ai' }),
    turboFixture({ stateChanges: { pending: { type: 'awaiting-choice' } } })
  ]) code(prepareRuntimeCommand(authority, contextFor(), activateTurboCommand()), 'ACTION_NOT_ALLOWED');

  for (const abilityKey of [null, '']) {
    const authority = turboFixture({ playerAbilityKey: abilityKey });
    code(prepareRuntimeCommand(authority, contextFor(), activateTurboCommand()), 'ACTION_NOT_ALLOWED');
  }
  const undefinedAbility = turboFixture();
  undefinedAbility.engineState.players.player.user.abilityKey = undefined;
  code(prepareRuntimeCommand(undefinedAbility, contextFor(), activateTurboCommand()), 'ACTION_NOT_ALLOWED');
  const malformedAbility = turboFixture({ playerAbilityKey: 7 });
  code(prepareRuntimeCommand(malformedAbility, contextFor(), activateTurboCommand()), 'INVALID_AUTHORITY');
});

test('S03-CBR-72: Turbo retry precedes state reads and descriptor failures never invoke getters', () => {
  const retry = turboFixture();
  const command = activateTurboCommand();
  retry.journal = recordTerminal(retry.journal, contextFor(), command, accepted).value;
  let stateReads = 0;
  Object.defineProperty(retry, 'engineState', {
    enumerable: true, configurable: true,
    get() { stateReads += 1; throw new Error('retry must return before engine state'); }
  });
  const replay = prepareRuntimeCommand(retry, contextFor(), command);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.kind, 'retry');
  assert.equal(stateReads, 0);

  for (const field of ['abilityKey', 'turboUsed']) {
    const accessor = turboFixture();
    let getterCalls = 0;
    const target = field === 'abilityKey'
      ? accessor.engineState.players.player.user : accessor.engineState.players.player;
    Object.defineProperty(target, field, {
      enumerable: true, configurable: true,
      get() { getterCalls += 1; return field === 'abilityKey' ? 'turbo' : false; }
    });
    code(prepareRuntimeCommand(accessor, contextFor(), activateTurboCommand()), 'INVALID_AUTHORITY');
    assert.equal(getterCalls, 0);
  }

  const frozen = turboFixture();
  const frozenCommand = deepFreeze(activateTurboCommand());
  deepFreeze(frozen);
  const prepared = prepareRuntimeCommand(frozen, contextFor(), frozenCommand);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.value.adapter, { engineFunction: 'activateTurbo', playerId: 'player' });
});

test('S03-CBR-73: sandboxAddCard prepares either target seat independently of actor and active seat', () => {
  for (const actorSeat of ['seat-a', 'seat-b']) {
    for (const [targetSeat, playerId] of [['seat-a', 'player'], ['seat-b', 'ai']]) {
      const authority = sandboxAddFixture({ active: actorSeat === 'seat-a' ? 'ai' : 'player' });
      const command = sandboxAddCommand('STD-020', targetSeat, { actorSeat });
      const before = structuredClone(authority);
      const result = prepareRuntimeCommand(authority, contextFor(actorSeat), command);
      assert.equal(result.ok, true, `${actorSeat}:${targetSeat}`);
      assert.deepEqual(result.value.adapter,
        { engineFunction: 'addSandboxCardToHand', playerId, cardId: 'STD-020' });
      assert.deepEqual(authority, before);
    }
  }
});

test('S03-CBR-74: sandboxAddCard rejects non-sandbox modes, result, busy, unknown seat and definition', () => {
  for (const mode of ['ai', 'tutorial']) {
    const authority = sandboxAddFixture({ mode });
    code(prepareRuntimeCommand(authority, contextFor(), sandboxAddCommand()), 'UNAVAILABLE_MODE');
  }
  for (const authority of [
    sandboxAddFixture({ stateChanges: { pending: { type: 'awaiting-choice' } } }),
    sandboxAddFixture({ stateChanges: {
      winner: 'player', victory: { lockedOutcome: 'player', lockedAtEffectId: 'effect-1', finished: true }
    } })
  ]) code(prepareRuntimeCommand(authority, contextFor(), sandboxAddCommand()), 'ACTION_NOT_ALLOWED');

  const authority = sandboxAddFixture();
  code(prepareRuntimeCommand(authority, contextFor(), sandboxAddCommand('STD-020', 'seat-c')), 'ACTION_NOT_ALLOWED');
  for (const definitionId of ['missing', 'toString', 'constructor']) {
    code(prepareRuntimeCommand(authority, contextFor(), sandboxAddCommand(definitionId)), 'ACTION_NOT_ALLOWED');
  }
});

test('S03-CBR-75: sandboxAddCard retry precedes state reads and planning rejects accessors without invoking them', () => {
  const retry = sandboxAddFixture();
  const command = sandboxAddCommand('STD-020', 'seat-b');
  retry.journal = recordTerminal(retry.journal, contextFor(), command, accepted).value;
  let stateReads = 0;
  Object.defineProperty(retry, 'engineState', {
    enumerable: true, configurable: true,
    get() { stateReads += 1; throw new Error('retry must return before engine state'); }
  });
  assert.equal(prepareRuntimeCommand(retry, contextFor(), command).value.kind, 'retry');
  assert.equal(stateReads, 0);

  const accessor = sandboxAddFixture();
  let playerReads = 0;
  Object.defineProperty(accessor.engineState.players, 'player', {
    enumerable: true, configurable: true,
    get() { playerReads += 1; return {}; }
  });
  code(prepareRuntimeCommand(accessor, contextFor(), sandboxAddCommand()), 'INVALID_AUTHORITY');
  assert.equal(playerReads, 0);

  const frozen = sandboxAddFixture({ mode: 'lab' });
  const frozenCommand = deepFreeze(sandboxAddCommand('STD-020', 'seat-b'));
  deepFreeze(frozen);
  assert.deepEqual(prepareRuntimeCommand(frozen, contextFor(), frozenCommand).value.adapter,
    { engineFunction: 'addSandboxCardToHand', playerId: 'ai', cardId: 'STD-020' });
});

test('S03-CBR-76: attack prepares card and user targets for either active seat without mutation', () => {
  for (const playerId of ['player', 'ai']) {
    const fixture = attackFixture({ playerId });
    const targets = [
      [{ kind: 'card', cardRef: fixture.targetRef }, fixture.target.uid],
      [{ kind: 'user', seatId: fixture.opponentSeat }, `${fixture.opponentId}-fortress`]
    ];
    for (const [target, targetUid] of targets) {
      const command = attackCommand(fixture.attackerRef, target, { actorSeat: fixture.actorSeat });
      const before = JSON.stringify(fixture.authority);
      const result = prepareRuntimeCommand(fixture.authority, contextFor(fixture.actorSeat), command);
      assert.equal(result.ok, true, `${playerId}:${target.kind}`);
      assert.deepEqual(result.value.adapter, {
        engineFunction: 'attack', playerId, attackerUid: fixture.attacker.uid, targetUid
      });
      assert.equal(JSON.stringify(fixture.authority), before);
    }
  }
});

test('S03-CBR-77: attack preserves Security, Hacking, Contact, QA and Encryption target rules', () => {
  const security = attackFixture({ targetId: 'STD-022' });
  code(prepareRuntimeCommand(security.authority, contextFor(),
    attackCommand(security.attackerRef, { kind: 'user', seatId: security.opponentSeat })), 'ACTION_NOT_ALLOWED');
  assert.equal(prepareRuntimeCommand(security.authority, contextFor(),
    attackCommand(security.attackerRef, { kind: 'card', cardRef: security.targetRef })).ok, true);

  const hacking = attackFixture({ attackerId: 'STD-123', targetId: 'STD-022', attackerChanges: { atk: 5 } });
  assert.equal(prepareRuntimeCommand(hacking.authority, contextFor(),
    attackCommand(hacking.attackerRef, { kind: 'user', seatId: hacking.opponentSeat })).ok, true);

  const contact = attackFixture({ attackerChanges: { summoningSick: true, grantedKeywords: ['CONTACT'] } });
  assert.equal(prepareRuntimeCommand(contact.authority, contextFor(),
    attackCommand(contact.attackerRef, { kind: 'card', cardRef: contact.targetRef })).ok, true);
  code(prepareRuntimeCommand(contact.authority, contextFor(),
    attackCommand(contact.attackerRef, { kind: 'user', seatId: contact.opponentSeat })), 'ACTION_NOT_ALLOWED');

  const qa = attackFixture({ attackerId: 'STD-100', attackerChanges: { summoningSick: true } });
  assert.equal(prepareRuntimeCommand(qa.authority, contextFor(),
    attackCommand(qa.attackerRef, { kind: 'user', seatId: qa.opponentSeat })).ok, true);

  const encrypted = attackFixture({ targetChanges: { grantedKeywords: ['ENCRYPTION'] } });
  code(prepareRuntimeCommand(encrypted.authority, contextFor(),
    attackCommand(encrypted.attackerRef, { kind: 'card', cardRef: encrypted.targetRef })), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-78: attack preserves card-specific declaration and target restrictions', () => {
  const obFirst = attackFixture({ attackerId: 'STD-091' });
  code(prepareRuntimeCommand(obFirst.authority, contextFor(),
    attackCommand(obFirst.attackerRef, { kind: 'user', seatId: obFirst.opponentSeat })), 'ACTION_NOT_ALLOWED');

  const scriptTurn = attackFixture({ attackerId: 'STD-181' });
  scriptTurn.authority.engineState.players.player.scriptActivatedTurn = null;
  code(prepareRuntimeCommand(scriptTurn.authority, contextFor(),
    attackCommand(scriptTurn.attackerRef, { kind: 'card', cardRef: scriptTurn.targetRef })), 'ACTION_NOT_ALLOWED');

  const registryTurn = attackFixture({ attackerId: 'STD-220' });
  registryTurn.attacker.std220RegistryExecutedTurn = registryTurn.authority.engineState.turnNumber;
  code(prepareRuntimeCommand(registryTurn.authority, contextFor(),
    attackCommand(registryTurn.attackerRef, { kind: 'user', seatId: registryTurn.opponentSeat })), 'ACTION_NOT_ALLOWED');
  assert.equal(prepareRuntimeCommand(registryTurn.authority, contextFor(),
    attackCommand(registryTurn.attackerRef, { kind: 'card', cardRef: registryTurn.targetRef })).ok, true);
});

test('S03-CBR-79: attack rejects invalid location, state, seat and reference scope', () => {
  for (const fixture of [
    attackFixture({ attackerChanges: { sleep: true } }),
    attackFixture({ attackerChanges: { summoningSick: true } }),
    attackFixture({ targetChanges: { sleep: false } }),
    attackFixture({ targetZone: 'back' })
  ]) code(prepareRuntimeCommand(fixture.authority, contextFor(fixture.actorSeat),
    attackCommand(fixture.attackerRef, { kind: 'card', cardRef: fixture.targetRef }, { actorSeat: fixture.actorSeat })),
  'ACTION_NOT_ALLOWED');

  const fixture = attackFixture();
  code(prepareRuntimeCommand(fixture.authority, contextFor(),
    attackCommand(fixture.attackerRef, { kind: 'user', seatId: 'seat-a' })), 'ACTION_NOT_ALLOWED');
  code(prepareRuntimeCommand(fixture.authority, contextFor(),
    attackCommand(fixture.attackerRef, { kind: 'user', seatId: 'seat-c' })), 'ACTION_NOT_ALLOWED');
  code(prepareRuntimeCommand(fixture.authority, contextFor('seat-b'),
    attackCommand(fixture.attackerRef, { kind: 'card', cardRef: fixture.targetRef }, { actorSeat: 'seat-b' })),
  'ACTION_NOT_ALLOWED');
});

test('S03-CBR-80: attack retry precedes reference reads and selected accessors never run', () => {
  const retry = attackFixture();
  const command = attackCommand(retry.attackerRef, { kind: 'card', cardRef: retry.targetRef });
  retry.authority.journal = recordTerminal(retry.authority.journal, contextFor(), command, accepted).value;
  let referenceReads = 0;
  Object.defineProperty(retry.authority, 'referenceState', {
    enumerable: true, configurable: true,
    get() { referenceReads += 1; throw new Error('retry must not read references'); }
  });
  assert.equal(prepareRuntimeCommand(retry.authority, contextFor(), command).value.kind, 'retry');
  assert.equal(referenceReads, 0);

  const accessor = attackFixture();
  let sleepReads = 0;
  Object.defineProperty(accessor.attacker, 'sleep', {
    enumerable: true, configurable: true,
    get() { sleepReads += 1; return false; }
  });
  code(prepareRuntimeCommand(accessor.authority, contextFor(),
    attackCommand(accessor.attackerRef, { kind: 'card', cardRef: accessor.targetRef })), 'INVALID_AUTHORITY');
  assert.equal(sleepReads, 0);
});

test('S03-CBR-81: executeLayered prepares ordered materials for either active seat without mutation', () => {
  for (const playerId of ['player', 'ai']) {
    const fixture = layeredFixture({ playerId });
    const command = executeLayeredCommand(fixture.sourceRef, fixture.materialRefs,
      fixture.destinationZone, fixture.destinationSlot, { actorSeat: fixture.actorSeat });
    const before = JSON.stringify(fixture.authority);
    const result = prepareRuntimeCommand(fixture.authority, contextFor(fixture.actorSeat), command);
    assert.equal(result.ok, true, playerId);
    assert.deepEqual(result.value.adapter, {
      engineFunction: 'playLayeredCard', playerId, uid: fixture.source.uid,
      materialUids: fixture.materials.map(card => card.uid), zone: fixture.destinationZone,
      options: { requestedSlot: fixture.destinationSlot }
    });
    assert.equal(JSON.stringify(fixture.authority), before);
  }
});

test('S03-CBR-82: executeLayered preserves hand material and explicit input order', () => {
  const fixture = layeredFixture({
    sourceId: 'SZTB-094', destinationZone: 'front',
    materialSpecs: [
      { id: 'SZTB-090', zone: 'hand' },
      { id: 'SZTB-091', zone: 'front' },
      { id: 'SZTB-092', zone: 'back' }
    ]
  });
  const orderedRefs = [fixture.materialRefs[2], fixture.materialRefs[0], fixture.materialRefs[1]];
  const result = prepareRuntimeCommand(fixture.authority, contextFor(),
    executeLayeredCommand(fixture.sourceRef, orderedRefs, 'front', 5));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.adapter.materialUids,
    [fixture.materials[2].uid, fixture.materials[0].uid, fixture.materials[1].uid]);
});

test('S03-CBR-83: executeLayered rejects rule, location, payment and slot failures', () => {
  const enemy = layeredFixture({ sourceId: 'STD-205', materialSpecs: [{ id: 'STD-020', zone: 'front', controller: 'ai' }] });
  code(prepareRuntimeCommand(enemy.authority, contextFor(),
    executeLayeredCommand(enemy.sourceRef, enemy.materialRefs)), 'ACTION_NOT_ALLOWED');

  const trash = layeredFixture({ sourceId: 'STD-205', materialSpecs: [{ id: 'STD-020', zone: 'trash' }] });
  code(prepareRuntimeCommand(trash.authority, contextFor(),
    executeLayeredCommand(trash.sourceRef, trash.materialRefs)), 'ACTION_NOT_ALLOWED');

  const costly = layeredFixture({ sourceId: 'STD-205', sourceChanges: { cost: 99 },
    materialSpecs: [{ id: 'STD-020', zone: 'front' }] });
  code(prepareRuntimeCommand(costly.authority, contextFor(),
    executeLayeredCommand(costly.sourceRef, costly.materialRefs)), 'ACTION_NOT_ALLOWED');

  const occupied = layeredFixture({ occupyDestination: true });
  code(prepareRuntimeCommand(occupied.authority, contextFor(),
    executeLayeredCommand(occupied.sourceRef, occupied.materialRefs,
      occupied.destinationZone, occupied.destinationSlot)), 'ACTION_NOT_ALLOWED');
});

test('S03-CBR-84: executeLayered retry precedes refs and selected accessors stay uncalled', () => {
  const retry = layeredFixture();
  const command = executeLayeredCommand(retry.sourceRef, retry.materialRefs, retry.destinationZone, retry.destinationSlot);
  retry.authority.journal = recordTerminal(retry.authority.journal, contextFor(), command, accepted).value;
  let referenceReads = 0;
  Object.defineProperty(retry.authority, 'referenceState', {
    enumerable: true, configurable: true,
    get() { referenceReads += 1; throw new Error('retry must not read references'); }
  });
  assert.equal(prepareRuntimeCommand(retry.authority, contextFor(), command).value.kind, 'retry');
  assert.equal(referenceReads, 0);

  const accessor = layeredFixture();
  let classReads = 0;
  Object.defineProperty(accessor.materials[0], 'classes', {
    enumerable: true, configurable: true,
    get() { classReads += 1; return []; }
  });
  code(prepareRuntimeCommand(accessor.authority, contextFor(),
    executeLayeredCommand(accessor.sourceRef, accessor.materialRefs,
      accessor.destinationZone, accessor.destinationSlot)), 'INVALID_AUTHORITY');
  assert.equal(classReads, 0);
});
