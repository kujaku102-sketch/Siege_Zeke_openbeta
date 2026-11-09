import { MAX_SAVED_DECKS, normalizeSavedDeck } from '../game/deck-builder.js';

// Deck files (修正キュー 2026-11-09, 文豪): [JSON出力] writes the deck being built, one deck, named after it; [JSON読込]
// takes that one deck, or a list of decks as the old export wrote them.

// A file name from the deck's name: what a Windows or Mac file name cannot hold becomes "_", and no name is "deck".
export function deckFileName(name) {
  const base = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 40);
  return `${base || 'deck'}.json`;
}

export function deckFileJson(deck) {
  return JSON.stringify(normalizeSavedDeck(deck, deck?.id || `deck-${Date.now()}`), null, 2);
}

// What a read file does to the saved decks: { decks, open } (open: the deck to show in the builder, or null), or null
// when the file holds neither a deck nor a list. A list replaces the saved decks, as before. One deck takes the place of
// the saved one with its id, else joins them, and is opened; it is left out when the decks are full (MAX_SAVED_DECKS).
export function readDeckFile(parsed, saved) {
  if (Array.isArray(parsed)) return { decks: parsed, open: null };
  if (!parsed || typeof parsed !== 'object' || !parsed.cards || typeof parsed.cards !== 'object') return null;
  const deck = normalizeSavedDeck(parsed, `deck-${Date.now()}`);
  const index = saved.findIndex(item => item.id === deck.id);
  if (index < 0 && saved.length >= MAX_SAVED_DECKS) return null;
  const decks = index < 0 ? [...saved, deck] : saved.map((item, at) => at === index ? deck : item);
  return { decks, open: deck };
}
