import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardInstance } from '../src/data/cards.js';
import { createGame } from '../src/game/engine.js';
import { applyPreparedRuntimeAction, classifyPreparedRuntimeAction } from '../src/game/runtime/transaction-actions.js';

test('S03-TRXA-01: fixed transaction handlers classify only exact prepared adapter shapes', () => {
  for (const adapter of [
    { engineFunction: 'addSandboxCardToHand', playerId: 'player', cardId: 'STD-001' },
    { engineFunction: 'installCard', playerId: 'ai', uid: 'rt:i:3' },
    { engineFunction: 'openingMulligan', playerId: 'player' },
    { engineFunction: 'recoverRegistryCard', playerId: 'player', uid: 'rt:i:2' },
    { engineFunction: 'restSecurity', playerId: 'ai', uid: 'rt:i:1' },
    { engineFunction: 'activateScript', playerId: 'player', uid: 'rt:i:4' },
    { engineFunction: 'playCard', playerId: 'player', uid: 'rt:i:5', options: { zone: 'front', requestedSlot: 1 } },
    { engineFunction: 'playLayeredCard', playerId: 'player', uid: 'rt:i:6', materialUids: ['rt:i:7'], zone: 'back', options: { requestedSlot: 2 } },
    { engineFunction: 'relogCard', playerId: 'player', uid: 'rt:i:8', targetZone: 'back', options: { requestedSlot: 3 } },
    { engineFunction: 'attack', playerId: 'player', attackerUid: 'rt:i:9', targetUid: 'ai-fortress' },
    { engineFunction: 'activateTurbo', playerId: 'player' },
    { engineFunction: 'endTurn', playerId: 'player' }
  ]) assert.deepEqual(classifyPreparedRuntimeAction(Object.freeze(adapter)), { ok: true, value: { kind: 'supported' } });
  for (const engineFunction of ['unknownAction', 'toString', '__proto__']) {
    assert.deepEqual(classifyPreparedRuntimeAction({ engineFunction, playerId: 'player' }), {
      ok: true, value: { kind: 'unsupported' }
    });
  }
});

test('S03-TRXA-02: malformed known adapters and accessors fail without fallback or getter execution', () => {
  for (const adapter of [
    null,
    [],
    { engineFunction: 'restSecurity', playerId: 'player' },
    { engineFunction: 'restSecurity', playerId: 'player', uid: 'rt:i:1', force: true },
    { engineFunction: 'installCard', playerId: 'player' },
    { engineFunction: 'installCard', playerId: 'player', uid: 'rt:i:3', force: true },
    { engineFunction: 'recoverRegistryCard', playerId: 'player' },
    { engineFunction: 'recoverRegistryCard', playerId: 'player', uid: 'rt:i:2', force: true },
    { engineFunction: 'openingMulligan', playerId: '' },
    { engineFunction: 'addSandboxCardToHand', playerId: 'player', cardId: 1 },
    { engineFunction: 'playCard', playerId: 'player', uid: 'rt:i:5', options: { zone: 'front', requestedSlot: 0 } },
    { engineFunction: 'playLayeredCard', playerId: 'player', uid: 'rt:i:6', materialUids: [], zone: 'back', options: { requestedSlot: 2 } },
    { engineFunction: 'relogCard', playerId: 'player', uid: 'rt:i:8', targetZone: 'registry', options: { requestedSlot: 3 } }
  ]) assert.deepEqual(classifyPreparedRuntimeAction(adapter), { ok: false, error: { code: 'INVALID_PREPARED_ACTION' } });
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'engineFunction', { enumerable: true, get() { reads += 1; return 'openingMulligan'; } });
  accessor.playerId = 'player';
  assert.deepEqual(classifyPreparedRuntimeAction(accessor), { ok: false, error: { code: 'INVALID_PREPARED_ACTION' } });
  assert.equal(reads, 0);
});

test('S03-TRXA-03: install apply distinguishes complete, prompt, selection, and refusal outcomes', () => {
  const fixture = (cardId, observer = false) => {
    const state = createGame({ mode: 'sandbox' });
    const card = createCardInstance(cardId, 'player', 1);
    state.active = 'player';
    state.players.player.hand = [card];
    state.players.player.registry = [];
    state.players.player.registryActionUsed = false;
    state.players.ai.front = observer ? [createCardInstance('STD-226', 'ai', 2)] : [];
    return { state, card };
  };
  const complete = fixture('STD-001');
  assert.deepEqual(applyPreparedRuntimeAction(complete.state, {
    engineFunction: 'installCard', playerId: 'player', uid: complete.card.uid
  }), { ok: true, value: { kind: 'applied-complete' } });
  const prompt = fixture('STD-224');
  assert.deepEqual(applyPreparedRuntimeAction(prompt.state, {
    engineFunction: 'installCard', playerId: 'player', uid: prompt.card.uid
  }), { ok: true, value: { kind: 'applied-awaiting-input' } });
  assert.equal(prompt.state.prompt?.type, 'plugin-number');
  const selection = fixture('STD-001', true);
  assert.deepEqual(applyPreparedRuntimeAction(selection.state, {
    engineFunction: 'installCard', playerId: 'player', uid: selection.card.uid
  }), { ok: true, value: { kind: 'applied-awaiting-input' } });
  assert.equal(selection.state.pending?.request?.continuation?.type, 'std226-compress');
  const refused = fixture('STD-001');
  refused.state.players.player.registryActionUsed = true;
  assert.deepEqual(applyPreparedRuntimeAction(refused.state, {
    engineFunction: 'installCard', playerId: 'player', uid: refused.card.uid
  }), { ok: true, value: { kind: 'refused' } });
});
