import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveView, readSavedView, saveView, fitBoard, placePopup, cardSelection, clearSelection, gestureMoved, canCancelSelection, cancelSelection } from "../src/ui-refresh/model.js";
import { createPreviewFixture } from "../src/ui-refresh/fixture.js";
import { boardHtml, handHtml, detailHtml, popupHtml, entryHtml, desktopHtml, mobileHtml, visibleCard } from "../src/ui-refresh/view.js";
import { sideHtml, handCardsHtml } from "../src/ui/render.js";
import { liveInteractionHtml, matchResultHtml } from "../src/ui-refresh/live-view.js";
import { planVisualEffects, snapshotVisualState } from "../src/ui/visual-effects.js";
import { createGame } from "../src/game/engine.js";
import { createSelectionRequest } from "../src/game/selection-model.js";
import { createCardInstance } from "../src/data/cards.js";
import { createEntryLogoController } from "../src/ui-refresh/entry-logo-glitch.js";
import { LOGO_FIT, LOGO_EFFECT_SPEED, logoEffectDelta, createLogoAreas, updateLogoAreas, createLogoBands, updateLogoBands } from '../src/ui-refresh/logo-noise-model.js';

test("effects stay off when no preference has been stored", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /effectsEnabled:\s*localStorage\.getItem\(EFFECTS_STORAGE_KEY\) === "on"/);
});

test("result waits for declared effects to finish and exposes rematch and title actions", () => {
  const state = createGame({ mode: "ai", rng: () => 0.5 });
  assert.equal(matchResultHtml(state), "");
  state.victory.lockedOutcome = "player";
  assert.equal(matchResultHtml(state), "");
  state.victory.finished = true;
  assert.match(matchResultHtml(state), /VICTORY/);
  assert.match(matchResultHtml(state), /data-live="rematch">再戦/);
  assert.match(matchResultHtml(state), /data-live="home">タイトルに戻る/);
  state.victory.lockedOutcome = "ai";
  assert.match(matchResultHtml(state), /DEFEAT/);
  state.victory.lockedOutcome = "draw";
  assert.match(matchResultHtml(state), /DRAW/);
});

test("combat transition produces damage and user hit cues", () => {
  const state = createGame({ mode: "ai", rng: () => 0.5 });
  const previous = snapshotVisualState(state);
  state.players.player.fortressStr -= 3;
  state.events.push({ id: 1, type: "user_damaged", playerId: "player", amount: 3 });
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, state);
  assert.ok(transition.effects.some(effect => effect.type === "user-hit" && effect.amount === 3));
});

test("security shield enter and exit follow front-zone sleep state", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const card = createCardInstance("STD-075", "player", 97003);
  card.grantedKeywords = ["SECURITY"];
  card.sleep = false;
  state.players.player.front = [card];
  const idle = snapshotVisualState(state);
  card.sleep = true;
  const root = { querySelectorAll: () => [{ dataset: { cardUid: card.uid }, querySelector: () => ({ getBoundingClientRect: () => ({ left: 5, top: 7, width: 48, height: 70 }) }) }] };
  const enter = planVisualEffects(root, idle, state);
  assert.ok(enter.effects.some(effect => effect.type === "security-shield-on" && effect.uid === card.uid));
  card.sleep = false;
  const exit = planVisualEffects(root, enter.next, state);
  assert.ok(exit.effects.some(effect => effect.type === "security-shield-off" && effect.rect.width === 48));
});

test("entry uses the supplied logo and concise outlined mode buttons", () => {
  const html = entryHtml("pc");
  assert.match(html, /alt="Siege÷Zeke"/);
  assert.match(html, /siege-zeke-logo-layers\.svg/);
  assert.match(html, /<canvas class="r2-logo-canvas" aria-hidden="true"/);
  assert.equal((html.match(/class="r2-entry-icon"/g) ?? []).length, 4);
  assert.match(html, /data-mode="tutorial"/);
  assert.match(html, /data-mode="ai"/);
  assert.match(html, /data-mode="sandbox"/);
  assert.match(html, /data-deck class="r2-deck-entry"/);
  assert.doesNotMatch(html, /GUIプレビュー|案内と盤面の見え方を確認/);
  assert.doesNotMatch(html, /<small>|基本操作を学ぶ|AIと対戦|自由に試す|デッキを組む/);
});

test("logo effect time runs at twice speed without changing the rendering interval", () => {
  assert.equal(LOGO_EFFECT_SPEED, 2);
  assert.equal(logoEffectDelta(1/30), 2/30);
  assert.equal(logoEffectDelta(.1), .2);
  assert.equal(logoEffectDelta(10), .2);
  assert.equal(logoEffectDelta(-1), 0);
  const elapsed = Array.from({length:15},()=>logoEffectDelta(1/30)).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(elapsed-1)<1e-10); // A one-second effect now lasts half a real second.
});

test("entry logo preserves 12 regions, CSS-pixel particles and forced profiles", () => {
  const areas=createLogoAreas(()=>.5);
  assert.equal(areas.length,12);
  assert.deepEqual(areas.map(a=>a.name).slice(-3),['ジ','ー','グ']);
  for(const area of areas){assert.ok(area.size>=6&&area.size<=12);assert.equal(area.box.length,4);}
  for(const [profile,expected] of [['distress',0],['mosaic',1]]){
    const {state,profiles}=updateLogoAreas(areas,.1,profile,()=>.5);
    for(let i=0;i<12;i++){assert.equal(profiles[i*4],expected);assert.ok(state[i*4]>=0&&state[i*4]<=1);}
  }
  updateLogoAreas(areas,10,'random',()=>0);
  assert.ok(areas.every(a=>a.profile===1&&a.size===6));
  updateLogoAreas(areas,20,'random',()=>.999);
  assert.ok(areas.every(a=>a.profile===0&&a.size<12));
});

test("entry bands retain 16 core, 3 kana and 4 chromatic marks with pixel height bounds", () => {
  const bands=createLogoBands(()=>.5);
  assert.equal(bands.length,23);
  assert.equal(bands.filter(b=>b.vertical).length,4);
  for(const [width,height] of [[860,344],[560,224],[320,128]]){
    const logoHeight=Math.min(width*LOGO_FIT[0]/(495/285),height*LOGO_FIT[1]);
    for(const clock of [0,.2,.5,.9,1.4]){
      const {positions}=updateLogoBands(bands,clock,1,width,height);
      for(let i=0;i<19;i++){
        const pixels=positions[i*4+3]*logoHeight;
        assert.ok(pixels>=3-.00001&&pixels<=(i<16?30:15)+.00001);
      }
    }
  }
});

test("logo lifecycle reuses the canvas and stops on OFF, navigation and reduced motion", () => {
  let starts=0,stops=0,refreshes=0,profile,change;
  const canvas={dataset:{}},img={src:'logo.svg'};
  let present=true;
  const root={querySelector:selector=>selector.includes('canvas')?(present?canvas:null):img};
  const motion={matches:false,addEventListener:(type,fn)=>{change=fn;},removeEventListener:()=>{change=null;}};
  const controller=createEntryLogoController({motion,mount:()=>{
    starts++;return {dispose(){stops++;},refresh(){refreshes++;},setProfile(value){profile=value;}};
  }});
  controller.sync(root,true);controller.sync(root,true,{profile:'mosaic'});
  assert.equal(starts,1);assert.equal(refreshes,1);assert.equal(profile,'mosaic');
  controller.sync(root,false);assert.equal(stops,1);assert.equal(canvas.dataset.noise,'static');
  controller.sync(root,true);assert.equal(starts,2);
  motion.matches=true;change();assert.equal(stops,2);
  motion.matches=false;change();assert.equal(starts,3);
  present=false;controller.sync(root,true);assert.equal(stops,3);
  present=true;controller.sync(root,true);assert.equal(starts,4);
  controller.suspend();assert.equal(stops,4);controller.resume();assert.equal(starts,5);
  controller.sync(root,true,{videoFile:{name:'noise.mp4'}});assert.equal(starts,6);assert.equal(stops,5);
  controller.dispose();assert.equal(stops,6);assert.equal(change,null);
});

test("logo WebGL failures stay on static fallback instead of retrying every render", () => {
  let starts=0;
  const canvas={dataset:{}};
  const root={querySelector:selector=>selector.includes('canvas')?canvas:{src:'logo.svg'}};
  const controller=createEntryLogoController({mount:()=>{starts++;return null;}});
  controller.sync(root,true);controller.sync(root,true);
  assert.equal(starts,1);assert.equal(canvas.dataset.noise,'static');
  controller.sync(root,false);controller.sync(root,true);assert.equal(starts,2);
  controller.dispose();
});

test("live target confirmation leaves the right turn rail for a board dock", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const candidate = createCardInstance("STD-075", "player", 95001);
  state.players.player.hand.push(candidate);
  state.pending = { type: "selection", request: createSelectionRequest({ mode: "single", candidates: [candidate.uid],
    count: 1, label: "対象を選択", candidateLabels: { [candidate.uid]: candidate.name } }) };
  const parts = liveInteractionHtml(state, null, { view: "mobile", detailUid: null, draft: null, effectsEnabled: false });
  assert.match(parts.commands, /aria-label="ターン操作"/);
  assert.match(parts.commands, /data-live="log"/);
  assert.doesNotMatch(parts.commands, /data-action="confirm-selection"/);
  assert.equal(parts.target, "");
  assert.match(parts.extras, /selection-confirm/);
  assert.match(parts.extras, /data-action="confirm-selection"/);
  assert.match(parts.extras, /data-live="selection-fold"[^>]*aria-expanded="true"/);
  assert.match(parts.extras, /class="selection-fold-cross"/);
  const collapsed = liveInteractionHtml(state, null, { view: "pc", detailUid: null, draft: null, selectionCollapsedFor: state.pending.request });
  assert.match(collapsed.extras, /data-live="selection-fold"[^>]*aria-expanded="false"/);
  assert.match(collapsed.extras, /候補を開く/);
  assert.match(collapsed.extras, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(collapsed.extras, /class="selection-fold-cross"/);
  assert.doesNotMatch(collapsed.extras, /data-selection-option=/);
  assert.match(collapsed.extras, /data-action="confirm-selection"/);
  assert.equal(state.pending.request.selected.length, 0);
  state.pending = { type: "layered-select", selectedTargets: [], requirement: { minimum: 1, label: "レイヤーを選択" } };
  const layered = liveInteractionHtml(state, null, { view: "mobile", detailUid: null, draft: null, effectsEnabled: false });
  assert.match(layered.target, /r2-target-dock/);
  assert.match(layered.target, /data-action="confirm-layered"/);
  assert.doesNotMatch(layered.commands, /data-action="confirm-layered"/);
});

test("R2 cancellation clears only current selection and detail, not game history", () => {
  const game = createPreviewFixture();
  game.history = [{ turnNumber: 99 }];
  const before = JSON.stringify(game);
  const selected = cardSelection(clearSelection(), game.players.player.hand[0].uid);
  const inspected = cardSelection(selected, game.players.player.hand[1].uid, { inspect: true });
  assert.equal(canCancelSelection(inspected), true);
  assert.deepEqual(cancelSelection(inspected), clearSelection());
  assert.equal(inspected.selectedUid, selected.selectedUid);
  assert.equal(JSON.stringify(game), before);
  const idle = clearSelection();
  assert.equal(canCancelSelection(idle), false);
  assert.equal(cancelSelection(idle), idle);
  const detailOnly = { selectedUid: null, detailUid: "inspect-only" };
  assert.equal(canCancelSelection(detailOnly), true);
  assert.deepEqual(cancelSelection(detailOnly), clearSelection());
});

test("R2 blocked cancellation preserves selection and never discards a pending choice", () => {
  const game = createPreviewFixture();
  game.pending = { type: "selection", request: { minimum: 1, selected: [] } };
  const before = JSON.stringify(game);
  const selected = cardSelection(clearSelection(), game.players.player.hand[0].uid);
  const options = { blocked: game.pending != null };
  assert.equal(canCancelSelection(selected, options), false);
  assert.equal(cancelSelection(selected, options), selected);
  assert.equal(JSON.stringify(game), before);
});

test("R2 exposes one initially disabled cancel button and no back or undo command", () => {
  const state = createPreviewFixture();
  for (const html of [desktopHtml(state, "ai"), mobileHtml(state, "ai")]) {
    assert.equal((html.match(/data-cancel/g) ?? []).length, 1);
    assert.match(html, /<button data-cancel disabled[^>]*>中止<\/button>/);
    assert.equal(html.includes(">戻る</button>"), false);
    assert.equal(html.includes("UNDO"), false);
    assert.equal(html.includes("r2-undo"), false);
  }
});

test("R2 frameless hand reuses the original fan geometry and keeps every card", () => {
  const state = createPreviewFixture();
  const before = JSON.stringify(state);
  const hand = handHtml(state);
  assert.ok(hand.includes(handCardsHtml(state, "player")));
  assert.equal(hand.includes("<header>"), false);
  assert.equal((hand.match(/class="hand-card"/g) ?? []).length, 12);
  assert.match(hand, /--hand-rotate:-8deg;--hand-sink:12px/);
  assert.match(hand, /--hand-rotate:8deg;--hand-sink:12px/);
  for (const card of state.players.player.hand) assert.ok(hand.includes(`data-card-uid="${card.uid}"`));
  assert.equal(JSON.stringify(state), before);
  state.players.player.hand = [];
  assert.match(handHtml(state), /手札なし/);
});

test("R2 contains the original board composition without placing the hand inside its transform", () => {
  const state = createPreviewFixture();
  const original = sideHtml(state, "ai", true) + sideHtml(state, "player", false);
  const board = boardHtml(state);
  assert.ok(board.includes(`<div class="battle-board">${original}</div>`));
  assert.equal(board.includes('r2-hand'), false);
  assert.equal(board.includes('r2-admin'), false);
  for (const html of [desktopHtml(state, "ai"), mobileHtml(state, "ai")]) {
    const boardStart = html.indexOf(board);
    assert.ok(boardStart >= 0);
    assert.ok(html.indexOf('data-layer="hand"') > boardStart + board.length);
  }
});

test("R2 explicit URL > saved preference > automatic browser detection", () => {
  assert.deepEqual(resolveView({ pathname: "/pc/", saved: "mobile", mobile: true }), { view: "pc", source: "url" });
  assert.equal(resolveView({ pathname: "/mobile/", saved: "pc", mobile: false }).view, "mobile");
  assert.equal(resolveView({ saved: "pc", mobile: true }).view, "pc");
  assert.equal(resolveView({ mobile: true }).view, "mobile");
  assert.equal(resolveView({ mobile: false }).view, "pc");
  assert.equal(resolveView({ saved: "invalid", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18)" }).view, "mobile");
  assert.equal(resolveView({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" }).view, "pc");
  assert.equal(resolveView({ userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile" }).view, "mobile");
  assert.equal(resolveView({ userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 }).view, null);
  assert.equal(resolveView({ userAgent: "Mozilla/5.0 (Android 15)", mobile: false }).view, null);
  assert.equal(resolveView({}).view, null);
});
test("R2 handles unavailable storage without losing the UI", () => {
  const unavailable = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  assert.equal(readSavedView(unavailable), null);
  assert.equal(saveView(unavailable, "pc"), false);
  let saved;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  assert.equal(saveView(storage, "mobile"), true);
  assert.equal(readSavedView(storage), "mobile");
  assert.equal(saveView(storage, "invalid"), false);
});
test("R2 board keeps exact 4:3 across viewport sizes", () => {
  for (const [w,h] of [[1280,600],[844,320],[667,305],[1920,980],[300,800]]) {
    const box = fitBoard(w,h);
    assert.ok(box.width <= w && box.height <= h);
    assert.ok(Math.abs(box.width / box.height - 4/3) < 1e-12);
  }
});
test("R2 popup flips only above viewport edge and clamps horizontally by minimum distance", () => {
  const popup = { width: 160, height: 60 }, viewport = { width: 800, height: 600 };
  assert.deepEqual(placePopup({ left: 300, top: 200, bottom: 300, width: 100 }, popup, viewport), { left: 270, top: 132, side: "above", overflow: false });
  assert.deepEqual(placePopup({ left: 0, top: 20, bottom: 70, width: 50 }, popup, viewport), { left: 8, top: 78, side: "below", overflow: false });
  assert.equal(placePopup({ left: 780, top: 100, bottom: 200, width: 20 }, popup, viewport).left, 632);
  assert.equal(placePopup({ left: 0, top: 0, bottom: 590, width: 100 }, popup, viewport).overflow, true);
  const offset = placePopup({ left: 0, top: 0, bottom: 40, width: 20 }, popup, { left: 10, top: 5, width: 800, height: 600 });
  assert.equal(offset.left, 18);
});
test("R2 long-press changes detail only, normal taps switch, repeat keeps, blank clears", () => {
  let selection = cardSelection(clearSelection(), "A");
  assert.deepEqual(cardSelection(selection, "A"), selection);
  selection = cardSelection(selection, "B", { inspect: true });
  assert.deepEqual(selection, { selectedUid: "A", detailUid: "B" });
  assert.deepEqual(cardSelection(selection, "C", { blocked: true }), selection);
  assert.deepEqual(cardSelection(selection, "B"), { selectedUid: "B", detailUid: "B" });
  assert.deepEqual(clearSelection(), { selectedUid: null, detailUid: null });
  assert.equal(gestureMoved({ x: 0, y: 0 }, { x: 11, y: 0 }), true);
  assert.equal(gestureMoved({ x: 0, y: 0 }, { x: 3, y: 0 }), false);
});
test("R2 view rendering is non-mutating and does not expose opponent face-down cards", () => {
  const state = createPreviewFixture();
  const before = JSON.stringify(state);
  const board = boardHtml(state);
  const hidden = state.players.ai.back[0];
  assert.equal(board.includes(hidden.uid), false);
  assert.equal(visibleCard(state, hidden.uid), null);
  assert.equal(detailHtml(state, hidden.uid), "");
  assert.equal(detailHtml(state, state.players.ai.hand[0].uid), "");
  const own = state.players.player.hand[0];
  assert.ok(detailHtml(state, own.uid).includes(own.name));
  const spell = state.players.player.hand.find(card => card.category === "Sp");
  assert.match(popupHtml(state, spell.uid), /起動する/);
  assert.match(popupHtml(state, spell.uid), /disabled/);
  assert.equal(JSON.stringify(state), before);
});
test("R2 uses separate screen trees and escapes card text", () => {
  const state = createPreviewFixture();
  assert.match(desktopHtml(state, "ai"), /data-layout="desktop"/);
  assert.match(mobileHtml(state, "ai"), /data-layout="mobile"/);
  assert.equal(desktopHtml(state, "ai").includes("r2-mobile-tools"), false);
  for (const mode of ["tutorial","ai","sandbox"]) assert.ok(entryHtml("pc").includes(`data-mode="${mode}"`));
  assert.match(entryHtml("pc"), /r2-deck-entry/);
  assert.doesNotMatch(entryHtml("pc"), /01 \/ LEARN|02 \/ PLAY|03 \/ EXPLORE|INTERFACE STUDY/);
  state.players.player.hand[0].text = '<script>alert("x")</script>';
  const html = detailHtml(state, state.players.player.hand[0].uid);
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
});
