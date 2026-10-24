import test from "node:test";
import assert from "node:assert/strict";
import { USER_CARDS } from "../src/data/cards.js";
import { createGame } from "../src/game/engine.js";
import { BUILDABLE_CARDS, DECK_STORAGE_KEY, DECK_STRATEGIES, loadSavedDecks, recommendDeck, saveDeckCollection, validateDeck } from "../src/game/deck-builder.js";
import { captureDeckViewport, restoreDeckViewport } from "../src/ui/deck-viewport.js";
import { deckBuilderHtml, deckOptionsHtml } from "../src/ui-refresh/runtime-shell-view.js";
import { CARD_LIBRARY } from "../src/data/cards.js";
import { DECK_EVALUATION_AXES, evaluateCardForDeck } from "../src/game/card-deck-evaluation.js";

test("PC and mobile share one deck builder: same cards, filters and controls", () => {
 const state={savedDecks:[],deckBuilder:{open:true,color:'all',query:'',draft:{name:'<deck>',userId:'doors_zx',cards:{'STD-075':1}}}};
 const pc=deckBuilderHtml(state,{view:'pc',effectsEnabled:true});
 assert.match(pc,/data-deck-view="pc"/);assert.match(pc,/data-deck-fx="on"/);
 for(const attr of ['data-deck-save','data-deck-query','data-deck-color','data-deck-category','data-deck-management','data-deck-auto-build','data-deck-plus','data-deck-minus'])assert.ok(pc.includes(attr),attr);
 assert.ok(pc.includes('deck-tile'));assert.ok(!pc.includes('deck-catalog-card'));
 const before=JSON.stringify(state);
 const mobile=deckBuilderHtml(state,{view:'mobile',effectsEnabled:false});
 assert.match(mobile,/data-deck-panel="closed"/);assert.match(mobile,/data-deck-fx="off"/);
 assert.match(mobile,/data-deck-auto="closed"/);
 assert.ok(mobile.includes('deck-tile'));assert.ok(mobile.includes('&lt;deck&gt;'));
 assert.ok(mobile.indexOf('data-deck-auto-build')<mobile.indexOf('data-deck-management'));
 assert.ok(mobile.includes('data-deck-name'));assert.ok(mobile.includes('aria-label="ユーザーカード"'));
 assert.ok(mobile.includes('deck-builder-tools')&&mobile.includes('deck-category-filter'));
 assert.ok(mobile.indexOf('deck-summary')<mobile.indexOf('deck-builder-tools'));
 assert.ok(mobile.indexOf('deck-builder-tools')<mobile.indexOf('deck-catalog'));
 assert.equal((mobile.match(/deck-tile-placeholder/g)??[]).length,10);
 assert.match(mobile,/deck-tile-copies">×1<\/span>/);
 assert.match(mobile,/deck-tile-copies">1\/3<\/span>/);
 assert.ok(!mobile.includes('data-toggle-effects'));
 assert.ok(mobile.indexOf('deck-selected')<mobile.indexOf('deck-catalog'));
 assert.ok(!mobile.includes('data-deck-detail="STD-075"'));
 assert.ok(mobile.includes('長押しで詳細'));
 const complete=deckBuilderHtml({savedDecks:[],deckBuilder:{open:true,color:'all',query:'',draft:{name:'complete',userId:'doors_zx',cards:recommendDeck({userId:'doors_zx'}).cards}}},{view:'mobile',effectsEnabled:false});
 assert.match(complete,/deck-validation valid/);
 assert.match(complete,/構築OK/);
 assert.equal(JSON.stringify(state),before);
});

test("PC deck builder filters by category, removes from a deck tile and enforces the same-name limit", () => {
 const code=BUILDABLE_CARDS.find(card=>card.category==='Code'), script=BUILDABLE_CARDS.find(card=>card.category==='Script');
 const state={savedDecks:[],deckBuilder:{open:true,color:'all',query:'',category:'Code',draft:{name:'pc',userId:'doors_zx',cards:{[code.id]:3}}}};
 const pc=deckBuilderHtml(state,{view:'pc'});
 assert.match(pc,/data-deck-category="Code" aria-pressed="true"/);
 const catalog=pc.slice(pc.indexOf('class="deck-catalog"'));
 assert.ok(catalog.includes(`data-deck-card-id="${code.id}"`));
 assert.ok(!catalog.includes(`data-deck-card-id="${script.id}"`));
 const selected=pc.slice(pc.indexOf('class="deck-selected"'),pc.indexOf('deck-builder-tools'));
 assert.match(selected,new RegExp(`data-deck-summary-id="${code.id}"[\\s\\S]*?data-deck-minus="${code.id}"`));
 assert.match(catalog,new RegExp(`deck-tile-copies">3/3</span><button class="deck-tile-hit" data-deck-plus="${code.id}"[^>]*disabled`));
 const full=deckBuilderHtml({...state,deckBuilder:{...state.deckBuilder,category:'すべて',draft:{...state.deckBuilder.draft,cards:recommendDeck({userId:'doors_zx'}).cards}}},{view:'pc'});
 const plus=full.slice(full.indexOf('class="deck-catalog"')).match(/<button class="deck-tile-hit" data-deck-plus="[^"]+"[^>]*>/g);
 assert.ok(plus.length>0&&plus.every(button=>button.includes('disabled')));
});

test("management and auto-build panels keep every control without duplicating draft fields on PC and mobile", () => {
 for (const view of ["pc","mobile"]) {
 const state={savedDecks:[],deckBuilder:{open:true,color:'all',query:'',draft:{name:'panel test',userId:'doors_zx',cards:{}},managementOpen:true}};
 const manage=deckBuilderHtml(state,{view});
 for(const attr of ['data-deck-load','data-deck-new','data-deck-delete','data-deck-export','data-deck-import']) assert.ok(manage.includes(attr),attr);
 for(const attr of ['data-deck-name','data-deck-user','data-deck-save']) assert.equal((manage.match(new RegExp(attr,'g'))??[]).length,1,attr);
 assert.match(manage,/保存デッキ 0\/20/);
 const auto=deckBuilderHtml({...state,deckBuilder:{...state.deckBuilder,managementOpen:false,autoBuildOpen:true}},{view});
 for(const attr of ['data-deck-recommend-color','data-deck-strategy','data-deck-recommend']) assert.ok(auto.includes(attr),attr);
 assert.match(auto,/aria-label="自動構築を閉じる"/);
 assert.ok(!auto.includes('class="deck-management"'));
 }
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

test("automatic recommendations preserve existing cards and only fill the remainder", () => {
  const first = BUILDABLE_CARDS[0];
  const second = BUILDABLE_CARDS.find(card => card.name !== first.name);
  const existing = { [first.id]: 1, [second.id]: 2 };
  const result = recommendDeck({ userId: "doors_zx", color: "赤", strategy: "balanced", cards: existing });
  assert.equal(result.cards[first.id],1);
  assert.equal(result.cards[second.id],2);
  assert.equal(validateDeck({ userId: "doors_zx", cards: result.cards }).valid, true);
  assert.match(result.explanation,/既存3枚を維持・37枚追加/);
  const complete = recommendDeck({ userId: "doors_zx", cards: result.cards });
  assert.deepEqual(complete.cards, result.cards);
  assert.match(complete.explanation,/既存40枚を維持・0枚追加/);
});

test("deck evaluation metadata exposes common axes, explicit corrections and distinct strategy results", () => {
  assert.equal(DECK_EVALUATION_AXES.includes('removal'),true);
  assert.equal(evaluateCardForDeck(CARD_LIBRARY['STD-001']).removal,1);
  assert.equal(evaluateCardForDeck(CARD_LIBRARY['STD-001']).reliability,.75);
  const rush = recommendDeck({userId:'doors_zx',color:'赤',strategy:'rush'}).cards;
  const control = recommendDeck({userId:'doors_zx',color:'赤',strategy:'control'}).cards;
  assert.notDeepEqual(rush,control);
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
  state.deckBuilder = { open: true, color: "all", query: "", draft: oldDeck(), managementOpen: true };
  const root = { innerHTML: "" };
  const renderApp = () => { root.innerHTML = deckOptionsHtml(state, "") + deckBuilderHtml(state, { view: "pc" }); };
  renderApp();
  assert.match(root.innerHTML, /30\/40 · 同名3枚まで/);
  assert.match(root.innerHTML, /<option value="custom:old-zx"[^>]*disabled[^>]*>保存: 以前の30枚（要修正）<\/option>/);
  assert.match(root.innerHTML, /<option value="old-zx"[^>]*>以前の30枚（要修正）<\/option>/);
  assert.doesNotMatch(root.innerHTML, /<option value="old-zx"[^>]*disabled/);
  assert.match(root.innerHTML, /<button data-deck-save[^>]*disabled/);
  state.deckBuilder.draft = { ...oldDeck(), cards: cardsFor(40) };
  renderApp();
  assert.match(root.innerHTML, /40\/40 · 同名3枚まで/);
  assert.doesNotMatch(root.innerHTML, /<button data-deck-save[^>]*disabled/);
});

test("the seven 40-card start decks are the only preset choices and each starts an AI match", async () => {
  const { START_DECKS } = await import("../src/data/start-decks.js");
  const { DECK_OPTIONS } = await import("../src/game/engine.js");
  assert.deepEqual(START_DECKS.map((deck) => deck.color), ["赤", "黄", "紫", "青", "黒", "緑", "橙"]);
  for (const deck of START_DECKS) {
    assert.equal(validateDeck(deck).valid, true, deck.name);
    assert.equal(validateDeck(deck).count, 40);
    const game = createGame({ mode: "ai", playerDeckId: deck.id, aiDeckId: deck.id, rng: () => .5 });
    assert.equal(game.players.player.user.color, deck.color);
    assert.equal(game.players.player.hand.length + game.players.player.deck.length, 40);
  }
  const html = deckOptionsHtml({ savedDecks: [] }, "start-red");
  assert.deepEqual([...html.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]), START_DECKS.map((deck) => deck.id));
  for (const hidden of ["red", "yellow", "vengeance", "neutron"]) {
    assert.equal(DECK_OPTIONS[hidden].hidden, true);
    assert.doesNotMatch(html, new RegExp(`value="${hidden}"`));
  }
});
