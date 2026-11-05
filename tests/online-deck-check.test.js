import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeckChoice } from '../src/network/deck-check.js';
import { START_DECKS } from '../src/data/start-decks.js';
import { CARD_LIBRARY } from '../src/data/cards.js';

const startDeck = Object.values(START_DECKS)[0];

test('the seven start decks are accepted by id, with any user card', () => {
  const ids = Object.values(START_DECKS).map(deck => deck.id);
  assert.equal(ids.length, 7);
  for (const deckId of ids) {
    assert.deepEqual(checkDeckChoice({ userId: 'doors_zx', deck: { kind: 'start', deckId } }), { ok: true, value: { userId: 'doors_zx', deckId, recipe: null } });
  }
  assert.equal(checkDeckChoice({ userId: 'bigboss', deck: { kind: 'start', deckId: ids[0] } }).ok, true);
});

test('hidden or unknown decks and unknown users are refused', () => {
  for (const deckId of ['red', 'yellow', 'vengeance', 'neutron', 'start-pink', '', 7]) {
    assert.equal(checkDeckChoice({ userId: 'doors_zx', deck: { kind: 'start', deckId } }).error.code, 'DECK_START_UNKNOWN', String(deckId));
  }
  assert.equal(checkDeckChoice({ userId: 'nobody', deck: { kind: 'start', deckId: startDeck.id } }).error.code, 'DECK_USER_UNKNOWN');
  assert.equal(checkDeckChoice({ userId: 'toString', deck: { kind: 'start', deckId: startDeck.id } }).error.code, 'DECK_USER_UNKNOWN', 'inherited keys are not users');
  assert.equal(checkDeckChoice({ deck: { kind: 'start', deckId: startDeck.id } }).error.code, 'DECK_USER_UNKNOWN');
  assert.equal(checkDeckChoice({ userId: 'doors_zx', deck: { kind: 'mystery' } }).error.code, 'DECK_SHAPE');
  assert.equal(checkDeckChoice({ userId: 'doors_zx' }).error.code, 'DECK_SHAPE');
});

test('a custom recipe passes the deck builder rule and comes back in one stable order', () => {
  const recipe = Object.entries(startDeck.cards).reverse();
  const checked = checkDeckChoice({ userId: startDeck.userId, deck: { kind: 'custom', recipe } });
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.value.deckId, null);
  assert.equal(checked.value.recipe.reduce((sum, [, count]) => sum + count, 0), 40);
  const again = checkDeckChoice({ userId: startDeck.userId, deck: { kind: 'custom', recipe: Object.entries(startDeck.cards) } });
  assert.deepEqual(again.value.recipe, checked.value.recipe);
  // The same card listed twice is one card with two copies.
  const [[firstId, firstCount], ...rest] = Object.entries(startDeck.cards);
  const split = checkDeckChoice({ userId: startDeck.userId, deck: { kind: 'custom', recipe: [[firstId, firstCount - 1], [firstId, 1], ...rest] } });
  assert.deepEqual(split.value.recipe, checked.value.recipe);
});

test('a custom recipe that breaks the construction rule or names the wrong cards is refused', () => {
  const entries = Object.entries(startDeck.cards);
  const code = recipe => checkDeckChoice({ userId: startDeck.userId, deck: { kind: 'custom', recipe } }).error?.code;
  assert.equal(code(entries.slice(1)), 'DECK_RULE', 'too few cards');
  assert.equal(code([[entries[0][0], 9]]), 'DECK_RULE');
  assert.equal(code([['STD-NOPE', 3]]), 'DECK_CARD_UNKNOWN');
  assert.equal(code([['toString', 3]]), 'DECK_CARD_UNKNOWN', 'inherited keys are not cards');
  const token = Object.values(CARD_LIBRARY).find(card => card.token);
  if (token) assert.equal(code([[token.id, 3]]), 'DECK_CARD_NOT_BUILDABLE');
  assert.equal(code([[entries[0][0], 0]]), 'DECK_SHAPE');
  assert.equal(code([['STD-001']]), 'DECK_SHAPE');
});
