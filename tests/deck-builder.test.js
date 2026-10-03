import test from "node:test";
import assert from "node:assert/strict";
import { USER_CARDS } from "../src/data/cards.js";
import { createGame } from "../src/game/engine.js";
import { BUILDABLE_CARDS, DECK_STORAGE_KEY, DECK_STRATEGIES, loadSavedDecks, recommendDeck, saveDeckCollection, validateDeck } from "../src/game/deck-builder.js";
import { renderApp } from "../src/ui/render.js";
import { captureDeckViewport, restoreDeckViewport } from "../src/ui/deck-viewport.js";
import { deckBuilderHtml } from "../src/ui/render.js";

test("integrated deck design keeps PC controls and separates mobile cards from management", () => {
 const state={savedDecks:[],deckBuilder:{open:true,color:'all',query:'',draft:{name:'<deck>',userId:'doors_zx',cards:{'STD-075':1}}}};
 const pc=deckBuilderHtml(state,{view:'pc',effectsEnabled:true});
 assert.match(pc,/data-deck-view="pc"/);assert.match(pc,/data-deck-fx="on"/);
 for(const attr of ['data-deck-save','data-deck-import','data-deck-export','data-deck-recommend','data-deck-query'])assert.ok(pc.includes(attr));
 assert.ok(pc.includes('deck-catalog-card'));assert.ok(!pc.includes('deck-mobile-card'));
 const before=JSON.stringify(state);
 const mobile=deckBuilderHtml(state,{view:'mobile',effectsEnabled:false});
 assert.match(mobile,/data-deck-panel="closed"/);assert.match(mobile,/data-deck-fx="off"/);
 assert.ok(mobile.includes('deck-mobile-card'));assert.ok(mobile.includes('&lt;deck&gt;'));
 assert.ok(mobile.indexOf('deck-mobile-selected')<mobile.indexOf('deck-mobile-catalog'));
 assert.ok(!mobile.includes('data-deck-detail="STD-075"'));
 assert.ok(mobile.includes('長押しで詳細'));
 assert.equal(JSON.stringify(state),before);
});

test("deck viewport restores nested scroll, anchors a card after summary growth, and keeps button focus", () => {
  const panel = { scrollTop: 200, scrollLeft: 5, scrollHeight: 1000, clientHeight: 100,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }) };
  const list = { scrollTop: 0, scrollLeft: 0, scrollHeight: 700, clientHeight: 700 };
  const summary = { scrollTop: 35, scrollLeft: 0 };
  let cardBase = 250;
  const card = { dataset: { deckCardId: "STD-077" }, getBoundingClientRect: () => ({ top: cardBase - panel.scrollTop, bottom: cardBase - panel.scrollTop + 70 }) };
  let focusOptions;
  const button = { hasAttribute: name => name === "data-deck-plus", getAttribute: () => "STD-077", focus: options => { focusOptions = options; } };
  const nodes = { ".deck-builder": panel, ".deck-card-list": list, ".deck-summary": summary };
  const root = { ownerDocument: { activeElement: button }, querySelector: selector => nodes[selector],
    querySelectorAll: selector => selector === "[data-deck-card-id]" ? [card] : [button] };
  const snapshot = captureDeckViewport(root);
  panel.scrollTop = 0; panel.scrollLeft = 0; summary.scrollTop = 0; cardBase += 40;
  restoreDeckViewport(root, snapshot);
  assert.equal(panel.scrollTop, 240);
  assert.equal(card.getBoundingClientRect().top, 50);
  assert.equal(panel.scrollLeft, 5);
  assert.equal(summary.scrollTop, 35);
  assert.deepEqual(focusOptions, { preventScroll: true });
  assert.equal(captureDeckViewport({ querySelector: () => null }), null);
  restoreDeckViewport(root, null);
});

// Live user-sheet D2:M10 + rulebook 2.1, verified 2026-09-14.
const expected = {
  doors_zx: [40, 3], suckintosh: [40, 3], phoenix: [40, 3], humanoid: [40, 3],
  by_os: [60, 2], doors_nt: [30, 3], savage_salvage: [40, 3], extreme: [60, 1], bigboss: [50, 3]
};
const cardsFor = (count, copies = 3) => {
  const cards = {}, names = new Set();
  for (const card of BUILDABLE_CARDS) {
    if (names.has(card.name)) continue;
    names.add(card.name);
    cards[card.id] = Math.min(count, copies);
    count -= cards[card.id];
    if (count === 0) return cards;
  }
  throw new Error("Not enough distinct test cards");
};
const oldDeck = () => ({ id: "old-zx", name: "以前の30枚", userId: "doors_zx", cards: cardsFor(30) });
const fakeStorage = (decks) => {
  let value = JSON.stringify(decks);
  return {
    getItem(key) { assert.equal(key, DECK_STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, DECK_STORAGE_KEY); value = next; }
  };
};

test("all implemented user construction sizes match the source and default forty", () => {
  assert.deepEqual(Object.keys(USER_CARDS).sort(), Object.keys(expected).sort());
  for (const [userId, [size, sameName]] of Object.entries(expected)) {
    assert.deepEqual(validateDeck({ userId, cards: {} }).rule, { size, sameName }, userId);
    assert.equal(validateDeck({ userId, cards: cardsFor(size, sameName) }).valid, true, userId);
    for (const count of [size - 1, size + 1]) {
      assert.equal(validateDeck({ userId, cards: cardsFor(count, sameName) }).valid, false, `${userId}/${count}`);
    }
    assert.equal(validateDeck({ userId, cards: { [BUILDABLE_CARDS[0].id]: sameName + 1 } }).errors.some(error => error.endsWith(`/${sameName}枚`)), true);
  }
  assert.equal(validateDeck(oldDeck()).valid, false);
  assert.deepEqual(validateDeck(oldDeck()).errors, ["カード枚数 30/40"]);
});

test("every user's recommended decks use the correct size for every strategy", () => {
  for (const [userId, [size]] of Object.entries(expected)) {
    for (const strategy of Object.keys(DECK_STRATEGIES)) {
      const check = validateDeck({ userId, cards: recommendDeck({ userId, strategy }).cards });
      assert.equal(check.valid, true, `${userId}/${strategy}`);
      assert.equal(check.count, size, `${userId}/${strategy}`);
    }
  }
});

test("loading an old thirty-card ZX deck preserves it and does not write storage", () => {
  const deck = oldDeck();
  const storage = fakeStorage([deck]);
  const before = storage.getItem(DECK_STORAGE_KEY);
  const loaded = loadSavedDecks(storage);
  assert.deepEqual(loaded, [deck]);
  assert.equal(storage.getItem(DECK_STORAGE_KEY), before);
  assert.equal(validateDeck(loaded[0]).valid, false);
});

test("saving or importing a collection never drops another deck made invalid by corrected rules", () => {
  const legacy = oldDeck(), storage = fakeStorage([legacy]);
  const valid = { id: "new-zx", name: "40枚", userId: "doors_zx", cards: cardsFor(40) };
  saveDeckCollection([...loadSavedDecks(storage), valid], storage);
  assert.deepEqual(loadSavedDecks(storage), [legacy, valid]);
  const repaired = { ...legacy, cards: cardsFor(40) };
  saveDeckCollection([repaired, valid], storage);
  assert.deepEqual(loadSavedDecks(storage), [repaired, valid]);
  assert.equal(validateDeck(loadSavedDecks(storage)[0]).valid, true);
});

test("the builder exposes invalid saved decks for repair but disables their play and save choices", () => {
  const state = createGame({ mode: "ai", rng: () => .5 });
  state.savedDecks = [oldDeck()];
  state.deckBuilder = { open: true, color: "all", query: "", draft: oldDeck() };
  const root = { innerHTML: "" };
  renderApp(root, state, null);
  assert.match(root.innerHTML, /構築枚数 30\/40枚・同名3枚まで/);
  assert.match(root.innerHTML, /<option value="custom:old-zx"[^>]*disabled[^>]*>保存: 以前の30枚（要修正）<\/option>/);
  assert.match(root.innerHTML, /<option value="old-zx"[^>]*>以前の30枚（要修正）<\/option>/);
  assert.doesNotMatch(root.innerHTML, /<option value="old-zx"[^>]*disabled/);
  assert.match(root.innerHTML, /<button data-deck-save[^>]*disabled/);
  state.deckBuilder.draft = { ...oldDeck(), cards: cardsFor(40) };
  renderApp(root, state, null);
  assert.match(root.innerHTML, /構築枚数 40\/40枚・同名3枚まで/);
  assert.doesNotMatch(root.innerHTML, /<button data-deck-save[^>]*disabled/);
});
