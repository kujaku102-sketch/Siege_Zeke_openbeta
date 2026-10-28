import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isIosWebKit, resolveView, readSavedView, saveView, fitBoard, placePopup, cardSelection, clearSelection, gestureMoved } from "../src/ui-refresh/model.js";
import { planVisualEffects, snapshotVisualState } from "../src/ui/visual-effects.js";
import { createGame } from "../src/game/engine.js";
import { createCardInstance } from "../src/data/cards.js";
import { watchContextLoss } from "../src/ui-refresh/wireframe/render-resolution.js";
import { createEntryLogoController } from "../src/ui-refresh/entry-logo-glitch.js";
import { LOGO_FIT, LOGO_EFFECT_SPEED, logoEffectDelta, createLogoAreas, updateLogoAreas, createLogoBands, updateLogoBands } from '../src/ui-refresh/logo-noise-model.js';

// Source text checks read LF lines whatever the checkout wrote (core.autocrlf=true gives CRLF).
const readSource = async path => (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("effects stay off when no preference has been stored", async () => {
  const source = await readSource("../src/main.js");
  assert.match(source, /effectsEnabled:\s*localStorage\.getItem\(EFFECTS_STORAGE_KEY\) === "on"/);
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
test("match notices show Japanese sentences, never raw codes, and ignore taps off valid targets", async () => {
  const { noticeText, FALLBACK_NOTICE } = await import("../src/ui-refresh/notice-text.js");
  const { BLOCK_MESSAGES } = await import("../src/ui-refresh/runtime-read-view.js");
  assert.equal(noticeText("INTERACTION_TARGET_NOT_AVAILABLE"), null);
  for (const [code, message] of Object.entries(BLOCK_MESSAGES)) assert.equal(noticeText(code), message, code);
  assert.equal(noticeText("ACTION_NOT_ALLOWED"), FALLBACK_NOTICE);
  assert.equal(noticeText("AMBIGUOUS_INTERACTION_TARGET"), "対象を絞り込めません。もう一度選んでください");
  for (const code of ["SOME_UNKNOWN_CODE", "RUNTIME_RENDER_FAILED", "toString", "__proto__", undefined]) assert.equal(noticeText(code), FALLBACK_NOTICE, String(code));
  for (const code of ["ACTION_NOT_ALLOWED", "AMBIGUOUS_INTERACTION_TARGET", "MEMORY_SHORT", "MATCH_SESSION_COMMAND_INFLIGHT"]) assert.doesNotMatch(noticeText(code), /[A-Z]{2,}_[A-Z]/);
  const source = await readSource("../src/main.js");
  assert.match(source, /const notice = code => \{const text = noticeText\(code\);[^}]*if \(text === null\) return;host\.notice = text;/);
});

test("iOS WebKit is told from iPhone, iPod, iPad and the iPadOS desktop-site Mac, not from a Mac or Android", () => {
  const ua = { iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140", ipod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0)",
    ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    android: "Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile Safari/537.36", windows: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" };
  for (const name of ["iphone", "ipod", "ipad"]) assert.equal(isIosWebKit({ userAgent: ua[name] }), true, name);
  assert.equal(isIosWebKit({ userAgent: ua.mac, platform: "MacIntel", maxTouchPoints: 5 }), true, "iPadOS asking for the desktop site");
  assert.equal(isIosWebKit({ userAgent: ua.mac, platform: "MacIntel", maxTouchPoints: 0 }), false, "a Mac");
  assert.equal(isIosWebKit({ userAgent: ua.mac, platform: "MacIntel" }), false);
  assert.equal(isIosWebKit({ userAgent: ua.android, maxTouchPoints: 5 }), false);
  assert.equal(isIosWebKit({ userAgent: ua.windows, platform: "Win32", maxTouchPoints: 10 }), false);
  assert.equal(isIosWebKit(), false);
});

test("a lost WebGL context is answered at once and a restored one is reported; removal detaches both", () => {
  const listeners = new Map();
  const canvas = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const seen = [];
  const stop = watchContextLoss(canvas, { onLost: () => seen.push("lost"), onRestored: () => seen.push("restored") });
  let prevented = false;
  listeners.get("webglcontextlost")({ preventDefault: () => { prevented = true; } });
  listeners.get("webglcontextrestored")({});
  assert.equal(prevented, true, "default is prevented so the browser may restore the context");
  assert.deepEqual(seen, ["lost", "restored"]);
  stop();
  assert.equal(listeners.size, 0);
});

test("lowGpu reaches the match surface and the title; the drawn layers never take input, so the SVG hit areas stay the only targets", async () => {
  const main = await readSource("../src/main.js");
  assert.ok(main.includes("const renderDetection = {iosWebKit:isIosWebKit({"));
  assert.ok(main.includes("const lowGpu = () => renderMode().mode === 'compat';"));
  assert.ok(main.includes("host.effectsEnabled && !lowGpu()"));
  assert.ok(main.includes("return {lowGpu:mode === 'compat',renderQuality:renderQualityFor(mode,urlRenderScale(location.search))};"));
  assert.ok(!main.includes("setItem('renderScale'") && !/localStorage\.setItem\([^)]*[Ss]cale/.test(main), "the sample scale is never saved");
  assert.ok(main.includes("view:host.view,...renderOptions(),onContextLost:degradeAfterLoss,"));
  // A switch (a choice or a lost context) reconfigures the mounted match with the same pair.
  assert.equal(main.split("surface?.configure(renderOptions());").length - 1, 2);
  const surface = await readSource("../src/ui-refresh/runtime-match-surface.js");
  assert.ok(surface.includes("if (options.renderQuality) scenes.setRenderQuality(options.renderQuality);"));
  const scenes = await readSource("../src/ui-refresh/surface-scenes.js");
  assert.ok(scenes.includes("svg && !lowGpu"));
  assert.ok(scenes.includes("hudCanvas && !lowGpu"));
  const css = await readSource("../src/ui-refresh/wireframe/board.css");
  for (const selector of [".wf-board-model", ".wf-hud-model"]) {
    const rule = css.split("\n").find(line => line.includes(selector + " {"));
    assert.ok(rule && rule.includes("pointer-events:none"), selector + " never takes input");
  }
});

test("a tap on an occupied slot answers a slot request, and a card request still wins on the card", async () => {
  const { routeClick } = await import("../src/ui-refresh/surface-clicks.js");
  const ref = "r:" + "a".repeat(32);
  const slot = { dataset: { seat: "a", zone: "front", slot: "1" } }, card = { dataset: { cardRef: ref } };
  const request = (options) => ({ requestId: "q", constraints: { kind: "pick", minimum: 1, maximum: 1 }, options });
  const run = (interaction, request) => {
    const hits = [];
    const wire = { hasAttribute: () => false, closest: selector => selector === "[data-card-ref]" ? card
      : selector === ".board-slot[data-seat][data-zone][data-slot]" ? slot : selector === '[data-live-region="board"]' ? {} : null };
    const ui = { hitTarget: hit => { hits.push(hit); return { ok: true, value: {} }; } };
    routeClick({ target: { closest: selector => selector === "button" ? null : selector === "[data-wire-hit]" ? wire : null } },
      { ui, act: () => {}, boardStyle: "wireframe", latest: () => ({ request, interactionRequest: interaction, stage: null }) });
    return hits;
  };
  const slotOnly = { requestId: "q", options: [{ optionId: "d", targets: [{ kind: "slot", seatId: "a", zone: "front", slot: 1 }] }] };
  assert.deepEqual(run(slotOnly, request([{ optionId: "d", zone: "front", slot: 1 }])), [{ kind: "slot", seatId: "a", zone: "front", slot: 1 }]);
  const cardOnly = { requestId: "q", options: [{ optionId: "c", targets: [{ kind: "card", cardRef: ref }] }] };
  assert.deepEqual(run(cardOnly, request([{ optionId: "c", cardRef: ref }])), [{ kind: "card", cardRef: ref }]);
});

test("a tap on the guide's line goes to the guide, a tap on its buttons to the button", async () => {
  const { routeClick } = await import("../src/ui-refresh/surface-clicks.js");
  const run = button => {
    const calls = [];
    const target = { closest: selector => selector === ".live-guide-speech" ? {} : selector === "button" ? button : null };
    routeClick({ target }, { ui: {}, act: () => {}, latest: () => null, tapGuide: () => calls.push("tap"), turnGuidePage: delta => calls.push(delta) });
    return calls;
  };
  assert.deepEqual(run(null), ["tap"]);
  assert.deepEqual(run({ hasAttribute: name => name === "data-runtime-guide-next" }), [1]);
});

test("while the guide speaks the match takes no input; a tap puts it away until the next step or a new reason", async () => {
  const surface = await readSource("../src/ui-refresh/runtime-match-surface.js");
  assert.ok(surface.includes("const reading = Boolean(tutorial.ok && tutorial.value.presentation && !tutorial.value.away);"));
  assert.ok(surface.includes("const forward = root.querySelector(press ? '.live-guide [data-runtime-guide-next]' : '.live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next])');"), "a step pointing at a button to press is a move");
  assert.ok(surface.includes("if (forward) { forward.click(); return; }\n    guideAway = { step: pageStep(tutorial.value.flow), reason: guideReason(tutorial.value) };"), "[次へ] where there is one, else put away");
  assert.ok(surface.includes("if (guideAway && guideAway.step !== pageStep(tutorial.value.flow)) guideAway = null;"), "back on the next step");
  assert.ok(surface.includes("const away = guideAway?.reason === guideReason(tutorial.value) ? { away: true } : {};"), "back with a refused move's reason");
  assert.ok(surface.includes("if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.live-guide-text')) {"), "the keyboard's tap");
  const view = await readSource("../src/ui-refresh/runtime-read-view.js");
  assert.ok(view.includes(`if (tutorial.away) return '<aside class="live-guide-away" aria-label="チュートリアル"><button class="live-guide-skip" data-runtime-tutorial-skip>スキップ</button></aside>';`), "[スキップ] stays");
  assert.ok(view.includes("presentation.expect?.type === 'advance' && !presentation.expect.press ?"), "a press step has no [次へ]");
  assert.ok(surface.includes("if (expect?.press && guideAway && PRESS_OPEN[expect.press]?.(expect.cardId)) {"), "a press step moves on once what it asks is open");
  assert.ok(surface.includes("} else if (guideAway?.hold && !anyOpen()) { guideAway = null; render(ui.read()); }"), "the next line waits until it is closed");
  const css = await readSource("../src/ui-refresh/live.css");
  assert.ok(css.includes("padding:.4em .45em .4em .9em; pointer-events:auto; cursor:pointer;"), "the frame takes the tap");
});

test("the red tutorial's look-and-see steps move on when what they ask is pressed (文豪, 2026-10-28)", async () => {
  const { tutorialSteps } = await import("../src/data/tutorial-script.js");
  const steps = tutorialSteps("basics");
  assert.deepEqual(steps[19].expect, { type: "advance", press: "info-button" });
  assert.deepEqual(steps[26].expect, { type: "advance", press: "ability-badge", cardId: "STD-091" });
  assert.deepEqual(steps[36].expect, { type: "advance", press: "card-detail", cardId: "STD-078" });
  assert.equal(steps.filter(step => step.expect?.press).length, 3);
});

test("opening protocol v2.4 is opt-in by URL and only for the AI mode; the redraw pick has its own wording", async () => {
  const main = await readSource("../src/main.js");
  assert.ok(main.includes("mode === 'ai' && new URLSearchParams(location.search).get('opening') === 'v2.4' ? {openingProtocol:'v2.4'} : {}"));
  assert.ok(main.includes("gameOptions:{\n    ...opening,mode,tutorialId,"));
  const { presentationLabel } = await import("../src/ui-refresh/choice-read-view.js");
  assert.equal(presentationLabel("opening-mulligan"), "引き直すカードを選択");
});

test("render mode UI: the title note is outside the stage and only in compat; the HTML options window has the row, the CRT one does not", async () => {
  const { runtimeShellHtml } = await import("../src/ui-refresh/runtime-shell-view.js");
  const base = { screen: "entry", view: "pc", options: false, effectsEnabled: false, savedDecks: [], deckBuilder: { open: false }, catalog: { query: "", expansion: "all", catalogOwner: "player" },
    storedCounts: { replays: 0, logs: 0 }, renderPreference: "auto", render: { mode: "compat", reason: "detected" }, renderUrl: null };
  const note = html => html.split('<aside class="r2-render-note"')[1]?.split("</aside>")[0] ?? null;
  const compat = runtimeShellHtml(base);
  assert.ok(note(compat).includes("軽量表示（WebGLなし）") && note(compat).includes('data-render-mode="full"'));
  assert.ok(compat.indexOf("r2-render-note") > compat.indexOf("</section>"), "the note follows the title stage, not inside it");
  assert.equal(note(runtimeShellHtml({ ...base, render: { mode: "full", reason: "default" } })), null);
  assert.equal(note(runtimeShellHtml({ ...base, screen: "game" })), null, "the note is for the title only");
  const locked = note(runtimeShellHtml({ ...base, renderUrl: "compat", render: { mode: "compat", reason: "url" } }));
  assert.ok(locked.includes("URLの指定が優先中") && !locked.includes("data-render-mode"));
  const options = runtimeShellHtml({ ...base, options: true, renderPreference: "full", render: { mode: "full", reason: "saved" } });
  const row = options.split('class="r2-title-render"')[1] ?? "";
  for (const value of ["auto", "compat", "full"]) assert.ok(row.includes('data-render-mode="' + value + '"'));
  assert.ok(row.includes('data-render-mode="full" role="radio" aria-checked="true"') && row.includes('data-render-mode="auto" role="radio" aria-checked="false"'));
  const crt = runtimeShellHtml({ ...base, options: true, effectsEnabled: true });
  assert.ok(!crt.includes("r2-title-render"), "the CRT-drawn options window keeps its fixed items");
});
