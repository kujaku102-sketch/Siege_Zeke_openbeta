// What the server accepts as a player's deck (design: サーバー設計-詳細.md §4.4).
// A start deck by id, or a custom recipe that passes the same construction rule as the deck builder.
// The server does not check ownership: the public staging card pool is open to everyone.
import { BUILDABLE_CARDS, validateDeck } from '../game/deck-builder.js';
import { START_DECKS } from '../data/start-decks.js';
import { CARD_LIBRARY, USER_CARDS } from '../data/cards.js';

const START_DECK_IDS = new Set(Object.values(START_DECKS).map(deck => deck.id));
const BUILDABLE_IDS = new Set(BUILDABLE_CARDS.map(card => card.id));
const failure = (code, errors) => ({ ok: false, error: { code, ...(errors ? { errors } : {}) } });

// input: { userId, deck: {kind:'start', deckId} | {kind:'custom', recipe:[[cardId, count], ...]} }
// -> { ok, value: { userId, deckId, recipe } } with exactly one of deckId / recipe set.
export function checkDeckChoice(input) {
  const userId = input?.userId, deck = input?.deck;
  if (typeof userId !== 'string' || !Object.hasOwn(USER_CARDS, userId)) return failure('DECK_USER_UNKNOWN');
  if (deck?.kind === 'start') {
    if (typeof deck.deckId !== 'string' || !START_DECK_IDS.has(deck.deckId)) return failure('DECK_START_UNKNOWN');
    return { ok: true, value: { userId, deckId: deck.deckId, recipe: null } };
  }
  if (deck?.kind !== 'custom' || !Array.isArray(deck.recipe)) return failure('DECK_SHAPE');
  const cards = {};
  for (const row of deck.recipe) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !Number.isSafeInteger(row[1]) || row[1] < 1) return failure('DECK_SHAPE');
    const [id, count] = row;
    if (!Object.hasOwn(CARD_LIBRARY, id)) return failure('DECK_CARD_UNKNOWN', [id]);
    if (!BUILDABLE_IDS.has(id)) return failure('DECK_CARD_NOT_BUILDABLE', [id]);
    cards[id] = (cards[id] ?? 0) + count;
  }
  const checked = validateDeck({ userId, cards });
  if (!checked.valid) return failure('DECK_RULE', checked.errors);
  // The same row order every time, so a recipe compares and records the same way.
  const recipe = Object.entries(cards).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([id, count]) => [id, count]);
  return { ok: true, value: { userId, deckId: null, recipe } };
}
