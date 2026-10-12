import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlReadModel } from '../src/adapters/html-read-model.js';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { runtimeGameHtml } from '../src/ui-refresh/runtime-read-view.js';

function session() {
  const created = createNewMatchSessionController({
    runtimeConfig: {
      matchId: 'html-read-match', seatIds: ['seat-a', 'seat-b'], seed: 71,
      ruleVersion: 'rules', cardVersion: 'cards',
      gameOptions: {
        mode: 'ai', playerDeckId: 'red', aiDeckId: 'yellow',
        playerDeckRecipe: [['STD-020', 10]], aiDeckRecipe: [['STD-020', 10]],
        playerUserId: 'doors_zx', aiUserId: 'suckintosh', sandboxDeckSetup: false
      }
    },
    sessionGeneration: 1
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
}

const localUi = overrides => ({
  selectedCardRef: null, detailCardRef: null,
  menuOpen: false, logOpen: false, handOpen: true, draft: null,
  ...overrides
});

function model(port, ui = localUi()) {
  const query = port.query();
  assert.equal(query.ok, true, JSON.stringify(query));
  const result = buildHtmlReadModel(query.value, ui);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

test('S05-READ-01: read model binds visible cards to legal actions without raw authority identifiers', () => {
  const current = session();
  const port = current.port('seat-a').value;
  const query = port.query().value;
  const handCard = query.observation.seats[0].hand.cards[0];
  const result = buildHtmlReadModel(query, localUi({
    selectedCardRef: handCard.cardRef, detailCardRef: handCard.cardRef
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  const value = result.value;
  const card = value.seats[0].hand.cards[0];
  assert.equal(card.interaction.selected, true);
  assert.equal(card.interaction.detailed, true);
  assert.ok(card.interaction.sourceActionIds.length > 0);
  assert.ok(card.interaction.sourceActionIds.every(actionId => value.legalActions.some(action => action.actionId === actionId)));
  assert.deepEqual(value.seats[1].hand, { count: query.observation.seats[1].hand.count });
  const serialized = JSON.stringify(value);
  for (const forbidden of ['"uid"', '"playerId"', '"engineState"', '"journal"', '"referenceState"', '"continuation"']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('S05-READ-02: stale local selection is dropped and caller mutation cannot change later models', () => {
  const current = session();
  const port = current.port('seat-a').value;
  const first = model(port, localUi({
    selectedCardRef: 'r:ffffffffffffffffffffffffffffffff',
    detailCardRef: 'r:ffffffffffffffffffffffffffffffff'
  }));
  assert.equal(first.ui.selectedCardRef, null);
  assert.equal(first.ui.detailCardRef, null);
  first.seats[0].user.name = 'mutated';
  first.legalActions.length = 0;
  const second = model(port);
  assert.notEqual(second.seats[0].user.name, 'mutated');
  assert.ok(second.legalActions.length > 0);
});

test('S05-READ-03: runtime renderer consumes only read model refs and retains current game values', () => {
  const current = session();
  const port = current.port('seat-a').value;
  const query = port.query().value;
  const handCard = query.observation.seats[0].hand.cards[0];
  const value = buildHtmlReadModel(query, localUi({
    selectedCardRef: handCard.cardRef, detailCardRef: handCard.cardRef
  })).value;
  const html = runtimeGameHtml(value);
  assert.match(html, /data-card-ref="r:[0-9a-f]{32}"/);
  assert.match(html, /data-action-id="action:0:/);
  assert.match(html, new RegExp(`MEM <b>${value.seats[0].memory.current}</b>/${value.seats[0].memory.max}`));
  assert.equal(html.includes('data-card-uid='), false);
  assert.equal(html.includes('data-owner="player"'), false);
  assert.equal(html.includes('engineState'), false);
});

test('S05-READ-04: revision updates replace the model without preserving old action IDs', () => {
  const current = session();
  const port = current.port('seat-a').value;
  const before = model(port);
  const endTurn = before.legalActions.find(entry => entry.kind === 'fixed' && entry.action.type === 'endTurn');
  assert.ok(endTurn);
  const submitted = port.submit({ commandId: 'read-turn', expectedRevision: 0, action: endTurn.action });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  const other = current.port('seat-b').value;
  const after = model(other, localUi({ draft: {
    kind: 'action', actionId: endTurn.actionId, choiceId: null, optionIds: [], allocation: []
  } }));
  assert.equal(after.match.revision, 1);
  assert.ok(after.legalActions.every(action => action.actionId.startsWith('action:1:')));
  assert.equal(JSON.stringify(after).includes(endTurn.actionId), false);
  assert.equal(after.ui.draft, null);
});

test('S05-READ-05: malformed query and UI accessors fail closed without running getters', () => {
  const current = session();
  const query = current.port('seat-a').value.query().value;
  let called = 0;
  const badUi = localUi();
  Object.defineProperty(badUi, 'menuOpen', { enumerable: true, get() { called += 1; return false; } });
  assert.deepEqual(buildHtmlReadModel(query, badUi), {
    ok: false, error: { code: 'HTML_READ_MODEL_INVALID_UI' }
  });
  assert.equal(called, 0);
  assert.deepEqual(buildHtmlReadModel({ ...query, extra: true }, localUi()), {
    ok: false, error: { code: 'HTML_READ_MODEL_INVALID_QUERY' }
  });
  assert.deepEqual(buildHtmlReadModel({
    ...query, status: { ...query.status, revision: query.status.revision + 1 }
  }, localUi()), { ok: false, error: { code: 'HTML_READ_MODEL_SCOPE_MISMATCH' } });
});
