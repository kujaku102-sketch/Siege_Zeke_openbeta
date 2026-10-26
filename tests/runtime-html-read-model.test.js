import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlReadModel } from '../src/adapters/html-read-model.js';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { runtimeGameHtml, runtimeGameRegions } from '../src/ui-refresh/runtime-read-view.js';
import { createMatchUiController } from '../src/adapters/match-ui-controller.js';
import { wireframeBoardHtml, wireframePreviewHtml } from '../src/ui-refresh/wireframe/board-view.js';
import { CARD, BOARD_CAMERA, project, boardSlots, cardSolid, pileHeight } from '../src/ui-refresh/wireframe/geometry.js';
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraView } from '../src/ui-refresh/wireframe/camera.js';

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

test('integrated board camera projects the same hit points as WebGL, including card thickness', () => {
  const camera=new PerspectiveCamera(BOARD_CAMERA.fov,1600/900,.1,80);
  camera.position.set(0,BOARD_CAMERA.distance,BOARD_CAMERA.distance);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  for(const [x,y,z] of [[525,450,0],[-20,50,30],[1070,850,50],[195,816,4],[855,84,0]]){
    const p=new Vector3((x-525)/100,z/100,(y-450)/100).project(camera),hit=project(x,y,z);
    assert.ok(Math.abs(hit.x-(p.x+1)*800)<1e-8);
    assert.ok(Math.abs(hit.y-(1-p.y)*450)<1e-8);
  }
});

test('reference HUD uses real per-seat STR, incidents and viewer memory rather than study values', () => {
  const current=session(),value=model(current.port('seat-a').value);
  value.seats[0].fortressStr=8;value.seats[0].memory={current:2,max:7};
  value.seats[0].user.incidents=[12,8,4];
  value.seats[1].fortressStr=13;
  const regions=runtimeGameRegions(value,{boardStyle:'wireframe'});
  assert.match(regions.board,/data-str="8"/);assert.match(regions.board,/data-str="13"/);
  assert.match(regions.board,/インシデント 12・8・4/);
  assert.match(regions.console,/メモリ 2 \/ 7/);assert.match(regions.console,/>2\/7</);
  assert.match(regions.board,/wf-board-model/);assert.match(regions.console,/<canvas class="wf-hud-model" aria-hidden="true" data-patch-keep="width height data-engine">/);
  current.dispose();
});

test('wireframe control kit retains legal actions, unique/detail routes and no permanent back', () => {
  const current = session();
  const value = model(current.port('seat-a').value);
  const card = value.seats[0].hand.cards[0];
  value.ui.detailCardRef = card.cardRef;
  const classic = runtimeGameRegions(value);
  const wire = runtimeGameRegions(value,{boardStyle:'wireframe'});
  assert.equal(wire.detail,classic.detail);
  assert.match(wire.board,/wf-self[\s\S]*wf-unique/);
  assert.match(wire.console,/wf-turn/);
  assert.match(wire.console,/data-runtime-menu/);
  // The i button only shows pile counts while held; the counts ride on the board.
  assert.match(wire.console,/data-runtime-counts/);
  assert.equal(wire.info,undefined);
  for (const zone of ['deck','trash','registry','ban']) assert.match(wire.board,new RegExp(`data-count-zone="${zone}"`));
  assert.doesNotMatch(wire.console,/data-runtime-back|unique-effect|r2-console/);
  const end=value.legalActions.find(a=>a.action?.type==='endTurn');
  assert.ok(wire.console.includes(`data-action-id="${end.actionId}"`));
  const noEnd={...value,globalActionIds:value.globalActionIds.filter(id=>id!==end.actionId),match:{...value.match,activeSeat:'seat-b'}};
  const waiting=runtimeGameRegions(noEnd,{boardStyle:'wireframe'}).console;
  assert.match(waiting,/data-runtime-end-turn disabled/);
  assert.match(waiting,/相手ターン/);
  assert.doesNotMatch(waiting,new RegExp(end.actionId));
  const resolving=runtimeGameRegions({...noEnd,match:{...noEnd.match,progress:'resultLocked'}},{boardStyle:'wireframe'}).console;
  assert.match(resolving,/解決中/);
  // The classic board keeps its own board but wears the same HUD, without the camera help.
  assert.equal(classic.console.replace(/<aside class="wf-status[\s\S]*$/,''),runtimeGameRegions(value,{boardStyle:'wireframe'}).console);
  assert.match(classic.console,/wf-self[\s\S]*wf-unique[\s\S]*wf-enemy/);
  for (const zone of ['deck','trash','registry','ban']) assert.match(classic.board,new RegExp(`data-count-zone="${zone}"`));
});

test('wireframe is opt-in and renders public seat identities and real placement limits', () => {
  const current = session();
  const value = model(current.port('seat-a').value);
  assert.doesNotMatch(runtimeGameHtml(value), /wire-board/);
  const html = runtimeGameHtml(value, {boardStyle:'wireframe'});
  assert.match(html, /r2-wireframe-view/);
  assert.doesNotMatch(html, /data-runtime-hand|手札を開く|手札を畳む/);
  assert.doesNotMatch(html, /board-camera|data-camera|camera-zoom|盤面の表示操作/);
  // The classic board raises its hand the same way, so neither board has an open/close button.
  assert.doesNotMatch(runtimeGameHtml(value), /data-runtime-hand|手札を開く|手札を畳む/);
  assert.match(html, /data-seat="seat-a"/);
  assert.match(html, /data-seat="seat-b"/);
  assert.match(html, /data-fortress="seat-b"/);
  const limit = value.seats.reduce((n,s)=>n+s.user.frontLimit+s.user.backLimit,0);
  assert.equal((html.match(/class="board-slot wf-slot"/g)??[]).length,limit);
  assert.doesNotMatch(html, /undefined|engineState|data-card-uid/);
  assert.equal(value.seats[1].hand.cards,undefined);
  const drawer=runtimeGameHtml(value,{boardStyle:'wireframe',zoneView:{seatId:'seat-b',zone:'trash'}});
  assert.match(drawer,/wf-zone-tabs/);
  assert.match(drawer,/wf-owner-tabs/);
  assert.match(drawer,/<aside class="wf-drawer cp-panel"/);
  assert.doesNotMatch(drawer,/<aside class="admin-drawer/);
  assert.match(drawer,/data-runtime-zone="ban"/);
  current.dispose();
});

test('wireframe selection keeps option identity without interactive markup inside a button', () => {
  const current=session(), value=model(current.port('seat-a').value);
  const card=value.seats[0].hand.cards[0];
  const request={requestId:'selection-markup',presentationKey:'card',
    options:[{optionId:'chosen-card',cardRef:card.cardRef}],constraints:{kind:'pick',minimum:1,maximum:1}};
  const html=runtimeGameRegions(value,{boardStyle:'wireframe',request}).selection;
  assert.match(html,/data-option-id="chosen-card"/);
  assert.ok(html.includes(card.definition.name));
  const option=html.match(/<button data-option-id="chosen-card"[^>]*>([\s\S]*?)<\/button>/)[1];
  assert.doesNotMatch(option,/<button|<details|<summary/);
  assert.match(html,/<footer><p>1枚選ぶとすぐ決定<\/p><\/footer>/);
  assert.doesNotMatch(html,/data-runtime-confirm/);
  current.dispose();
});

test('wireframe slot hit and ghost use the normal execution draft and commit once', () => {
  const current = session();
  const ui = createMatchUiController({session:current,viewerSeat:'seat-a'}).value;
  const initial=ui.read().value;
  const action=initial.model.legalActions.find(a=>a.actionType==='executeCard');
  assert.ok(action);
  const planned=ui.chooseAction(action.actionId).value;
  const target=planned.interactionRequest.options.flatMap(o=>o.targets).find(t=>t.kind==='slot');
  assert.ok(target);
  const chosen=ui.hitTarget(target);
  assert.equal(chosen.ok,true,JSON.stringify(chosen));
  assert.equal(chosen.value.model.match.revision,initial.model.match.revision);
  const ghost=wireframePreviewHtml(chosen.value);
  assert.match(ghost,/solid-ghost/);
  assert.match(ghost,/wf-arrow-tip/);
  const ready=ui.confirm();
  assert.equal(ready.ok,true,JSON.stringify(ready));
  assert.ok(ready.value.plan.completion);
  const done=ui.confirm();
  assert.equal(done.ok,true,JSON.stringify(done));
  assert.equal(done.value.model.match.revision,initial.model.match.revision+1);
  const seat=done.value.model.seats.find(s=>s.seatId===target.seatId);
  assert.equal(seat[target.zone].cards[0].location.position,target.slot);
  const html=wireframeBoardHtml(done.value.model);
  assert.ok(html.includes(`data-card-ref="${seat[target.zone].cards[0].cardRef}"`));
  assert.equal(wireframePreviewHtml(done.value),'');
  ui.dispose(); current.dispose();
});

test('an open execution draft has no confirm step and prompts for its slot over the board', () => {
  const current = session();
  const ui = createMatchUiController({session:current,viewerSeat:'seat-a'}).value;
  const initial=ui.read().value;
  const action=initial.model.legalActions.find(a=>a.actionType==='executeCard');
  const source=initial.model.seats[0].hand.cards.find(c=>c.interaction.sourceActionIds.includes(action.actionId));
  const selected=ui.selectCard(source.cardRef).value;
  assert.match(runtimeGameRegions(selected.model,{...selected,boardStyle:'wireframe'}).popup,/r2-popup/);
  const planned=ui.chooseAction(action.actionId).value;
  const regions=runtimeGameRegions(planned.model,{...planned,boardStyle:'wireframe'});
  assert.equal(regions.popup,'');
  assert.match(regions.selection,/配置先を選択/);
  assert.match(regions.selection,/盤面の明るいマスを選択/);
  assert.match(regions.selection,/board-pick-guide/);
  assert.doesNotMatch(regions.selection,/execution-destination|data-option-id|data-runtime-confirm|effect-modal/);
  ui.dispose(); current.dispose();
});

test('a hand card always offers its category routes and greys out the ones the engine blocks', () => {
  const current = createNewMatchSessionController({ runtimeConfig: { matchId: 'routes', seatIds: ['seat-a', 'seat-b'], seed: 71,
    ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode: 'ai', playerDeckId: 'red', aiDeckId: 'yellow',
      playerDeckRecipe: [['STD-077', 10]], aiDeckRecipe: [['STD-020', 10]], playerUserId: 'doors_zx', aiUserId: 'suckintosh',
      sandboxDeckSetup: false } }, sessionGeneration: 1 }).value;
  const ui = createMatchUiController({session:current,viewerSeat:'seat-a'}).value;
  const card = ui.read().value.model.seats[0].hand.cards[0];
  assert.deepEqual(ui.read().value.model.seats[0].enabledSymbols, []);
  const selected = ui.selectCard(card.cardRef).value;
  const popup = runtimeGameRegions(selected.model,{...selected,boardStyle:'wireframe'}).popup;
  assert.deepEqual(selected.model.actionBlocks.cards.filter(block => block.cardRef === card.cardRef),
    [{ cardRef: card.cardRef, actionType: 'executeCard', code: 'SYMBOL_MISSING', symbol: card.definition.color }]);
  assert.match(popup,/<button disabled aria-disabled="true" data-route="executeCard" data-block-code="SYMBOL_MISSING" title="シンボル不足で実行できません">実行<\/button>/);
  assert.match(popup,/<button data-route="install" data-action-id="[^"]+">インストール<\/button>/);
  ui.dispose(); current.dispose();
});

test('action blocks carry the engine reason after the registry action is spent and off turn', () => {
  const current = createNewMatchSessionController({ runtimeConfig: { matchId: 'blocks', seatIds: ['seat-a', 'seat-b'], seed: 71,
    ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode: 'ai', playerDeckId: 'red', aiDeckId: 'yellow',
      playerDeckRecipe: [['STD-077', 10]], aiDeckRecipe: [['STD-020', 10]], playerUserId: 'doors_zx', aiUserId: 'suckintosh',
      sandboxDeckSetup: false } }, sessionGeneration: 1 }).value;
  const ui = createMatchUiController({session:current,viewerSeat:'seat-a'}).value;
  const install = ui.read().value.model.legalActions.find(action => action.action?.type === 'install');
  const after = ui.chooseAction(install.actionId).value.model;
  assert.equal(after.actionBlocks.general, null);
  assert.ok(after.actionBlocks.cards.filter(block => block.actionType === 'install').length > 0);
  assert.ok(after.actionBlocks.cards.filter(block => block.actionType === 'install').every(block => block.code === 'REGISTRY_ACTION_USED'));
  const ended = ui.chooseAction(after.legalActions.find(action => action.action?.type === 'endTurn').actionId).value.model;
  assert.equal(ended.actionBlocks.general, 'NOT_YOUR_TURN');
  ui.dispose(); current.dispose();
});

test('wireframe geometry keeps card proportions, mirrored limits and bounded camera independent of runtime', () => {
  assert.equal(CARD.height/CARD.width,1.6);
  const slots=boardSlots({self:{frontLimit:4,backLimit:6},enemy:{frontLimit:4,backLimit:3}});
  const own=slots.filter(s=>s.seatId==='self'&&s.zone==='front');
  const other=slots.filter(s=>s.seatId==='enemy'&&s.zone==='front');
  assert.equal(own.length,4);
  assert.ok(own[0].x<525&&own[3].x>525);
  assert.deepEqual(other.map(s=>s.x),own.map(s=>1050-s.x));
  assert.equal(pileHeight(0),0);
  assert.ok(pileHeight(20)>pileHeight(1));
  assert.match(cardSolid(525,565,'card-line',false,20),/solid-side/);
  assert.notEqual(cardSolid(525,565),cardSolid(525,565,'card-line',true));
  const view=cameraView({zoom:10,panX:10000,panY:-10000},16/9);
  assert.equal(view.zoom,1.65);
  assert.ok(view.panX<1000&&view.panY>-500);
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

import { selectionCardHtml } from '../src/ui-refresh/runtime-read-view.js';
test('choice cards show art and name; the rules text only rides in the hidden peek', () => {
  const html = selectionCardHtml({ faceDown:false, definition:{ id:'STD-075', name:'ジャンキー', category:'Ob', cost:1, atk:1, str:1, text:'ターン終了時に破壊する。' },
    computed:{ currentCost:1, currentAtk:2, currentStr:1 } });
  assert.match(html, /<strong class="choice-card-name">ジャンキー<\/strong>/);
  const [visible, hidden] = html.split('<span class="selection-peek-source" hidden>');
  assert.doesNotMatch(visible, /ターン終了時/);
  assert.match(hidden, /ATK 2 \/ STR 1/);
  assert.match(hidden, /ターン終了時に破壊する。/);
  assert.match(selectionCardHtml({ faceDown:true }), /裏向きカード/);
});

import { isSinglePick, requestTitle } from '../src/ui-refresh/choice-read-view.js';
test('an optional single pick decides on the pick and shows the effect prompt as its title', () => {
  const pick = (minimum, maximum) => ({ requestId:'r', presentationKey:'card', options:[], constraints:{ kind:'pick', minimum, maximum } });
  assert.equal(isSinglePick(pick(0, 1)), true);
  assert.equal(isSinglePick(pick(1, 1)), true);
  assert.equal(isSinglePick(pick(0, 2)), false);
  assert.equal(requestTitle(pick(0, 1)), '選択');
  assert.equal(requestTitle({ ...pick(0, 1), title:'追加効果：自分エリアのカード1枚を破壊すると、相手ユーザーに2ダメージ' }),
    '追加効果：自分エリアのカード1枚を破壊すると、相手ユーザーに2ダメージ');
});

import { effectClauses, effectFocus, effectTextHtml, placeFlow } from '../src/ui-refresh/effect-flow.js';
import { selectionStage, stageGroupIds, stagedInteraction } from '../src/adapters/selection-stage.js';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';

test('effect flow lights the clause each pick of a multi-step card resolves', () => {
  const lucky = '相手のOb1体に3ダメージ。その後、自分エリアのカード1枚を破壊して①を起動できる。①相手ユーザーに2ダメージ。';
  assert.equal(effectClauses(lucky).length, 3);
  assert.equal(effectClauses('[レスポンス:3](相手から…。)相手のOb1体に6ダメージ。').length, 1);
  const lit = focus => lucky.slice(focus.start, focus.end);
  assert.equal(lit(effectFocus('STD-086', lucky, { presentationKey: 'execution-targets' })), '相手のOb1体に3ダメージ');
  assert.equal(lit(effectFocus('STD-086', lucky, { presentationKey: 'card', title: '追加効果：自分エリアのカード1枚を破壊すると…' })),
    '自分エリアのカード1枚を破壊して①を起動できる');
  const puppet = '[レスポンス:1]自分のOb1体を破壊し、相手Ob1体に2ダメージ。この効果で相手Obが破壊された場合、同じ縦列のOb1体に2ダメージ。';
  const request = { presentationKey: 'execution-targets' };
  assert.equal(lit2(puppet, effectFocus('STD-203', puppet, request, { index: 0, total: 2 })), '自分のOb1体を破壊し');
  assert.equal(lit2(puppet, effectFocus('STD-203', puppet, request, { index: 1, total: 2 })), '相手Ob1体に2ダメージ');
  // Unlisted cards fall back to the clause sharing the title's words, then the first clause naming a target.
  assert.equal(lit2('カードを1枚引く。相手のOb1体を破壊する。', effectFocus('STD-999', 'カードを1枚引く。相手のOb1体を破壊する。', { presentationKey: 'card', title: '破壊する相手のOb' })), '相手のOb1体を破壊する。');
  assert.equal(effectFocus('STD-999', 'ターン終了。', { presentationKey: 'execution-targets' }), null);
  const html = effectTextHtml(lucky, effectFocus('STD-086', lucky, { presentationKey: 'card', title: '追加効果' }));
  assert.match(html, /is-done">相手のOb1体に3ダメージ。/);
  assert.match(html, /is-now">その後、<mark>自分エリアのカード1枚を破壊して①を起動できる<\/mark>。/);
  assert.match(html, /is-next">①相手ユーザーに2ダメージ。/);
});
const lit2 = (text, focus) => text.slice(focus.start, focus.end);

test('a floating effect flow moves off the pick targets', () => {
  const viewport = { width: 1000, height: 600 }, panel = { width: 300, height: 100 };
  assert.deepEqual(placeFlow(panel, [], viewport), { left: 12, top: 12, area: 0 });
  const moved = placeFlow(panel, [{ left: 0, top: 0, right: 320, bottom: 130 }], viewport);
  assert.equal(moved.area, 0);
  assert.ok(moved.left >= 324 || moved.top >= 134);
});

test('picks from separate own and enemy groups are asked one group at a time', () => {
  const request = { requestId: 'r', options: ['a', 'b', 'x', 'y'].map(optionId => ({ optionId })), constraints: { kind: 'pick', minimum: 2, maximum: 2,
    groups: [{ minimum: 1, maximum: 1, optionIds: ['a', 'b'] }, { minimum: 1, maximum: 1, optionIds: ['x', 'y'] }] } };
  assert.deepEqual(selectionStage(request, null), { index: 0, total: 2, optionIds: ['a', 'b'] });
  assert.deepEqual(selectionStage(request, { requestId: 'r', optionIds: ['b'] }), { index: 1, total: 2, optionIds: ['x', 'y'] });
  assert.equal(selectionStage(request, { requestId: 'r', optionIds: ['b', 'y'] }).index, 2);
  assert.deepEqual(stageGroupIds(request, 'y'), ['x', 'y']);
  assert.deepEqual(stagedInteraction({ requestId: 'r', options: [{ optionId: 'a' }, { optionId: 'x' }] }, { optionIds: ['x'] }).options, [{ optionId: 'x' }]);
  const overlapping = { ...request, constraints: { ...request.constraints, groups: [request.constraints.groups[0], { minimum: 1, maximum: 1, optionIds: ['b', 'x'] }] } };
  assert.equal(selectionStage(overlapping, null), null);
  assert.equal(selectionStage({ ...request, constraints: { kind: 'pick', minimum: 1, maximum: 1, groups: [] } }, null), null);
});

// Two STD-020 Obs face each other with the card's colour installed, ready to cast it.
function flowMatch(id) {
  const lifecycle = createMatchLifecycleController({ nextMatchId: () => 'm' });
  const started = lifecycle.start({ matchId: 'm', seatIds: ['a', 'b'], seed: 1, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: { mode: 'sandbox', sandboxDeckSetup: true, playerDeckRecipe: [['STD-020', 40]], aiDeckRecipe: [['STD-020', 40]] } }).value;
  const ports = { a: started.port('a').value, b: started.port('b').value }, sandbox = started.sandboxControl('a').value;
  let serial = 0;
  const control = action => sandbox.submit({ commandId: `s${++serial}`, expectedRevision: ports.a.query().value.status.revision, action });
  const add = (seat, id) => { control({ type: 'sandboxAddCard', definitionId: id, targetSeat: seat });
    return ports[seat].query().value.observation.seats.find(row => row.seatId === seat).hand.cards.findLast(card => card.definition.id === id).cardRef; };
  const play = (seat, type, ref) => {
    const query = ports[seat].query().value;
    const entry = query.legalActions.find(item => (item.actionType ?? item.action?.type) === type && (item.base?.cardRef ?? item.action?.cardRef) === ref);
    const submit = action => ports[seat].submit({ commandId: `c${++serial}`, expectedRevision: query.status.revision, action });
    if (entry.kind === 'fixed') return submit(entry.action);
    const selections = [];
    for (;;) {
      const plan = ports[seat].queryAction({ expectedRevision: query.status.revision, actionId: entry.actionId, selections }).value;
      if (plan.completion) return submit(plan.completion.action);
      selections.push({ requestId: plan.selectionRequests[0].requestId, optionIds: [plan.selectionRequests[0].options[0].optionId], allocation: [] });
    }
  };
  play('a', 'install', add('a', id));
  play('a', 'executeCard', add('a', 'STD-020'));
  control({ type: 'sandboxSelectActiveSeat', targetSeat: 'b' });
  play('b', 'executeCard', add('b', 'STD-020'));
  control({ type: 'sandboxSelectActiveSeat', targetSeat: 'a' });
  return { started, ports, add, play };
}

test('傀儡特攻 asks the own Ob first, then the enemy Ob, and back returns to the own pick', () => {
  const { started, add } = flowMatch('STD-203');
  const spell = add('a', 'STD-203');
  const ui = createMatchUiController({ session: started, viewerSeat: 'a' }).value;
  const actionId = ui.read().value.model.legalActions.find(item => item.actionType === 'executeSpell' && item.base?.cardRef === spell).actionId;
  let read = ui.chooseAction(actionId);
  assert.equal(read.ok, true, JSON.stringify(read.error));
  const seatOf = optionId => {
    const target = read.value.interactionRequest.options.find(option => option.optionId === optionId)?.targets[0];
    return read.value.model.seats.find(seat => [...seat.front.cards, ...seat.back.cards].some(card => card.cardRef === target?.cardRef))?.seatId;
  };
  assert.equal(read.value.stage.index, 0);
  assert.deepEqual(read.value.interactionRequest.options.map(option => seatOf(option.optionId)), ['a']);
  const own = read.value.interactionRequest.options[0].optionId;
  read = ui.toggleOption(own);
  assert.equal(read.value.stage.index, 1);
  assert.deepEqual(read.value.interactionRequest.options.map(option => seatOf(option.optionId)), ['b']);
  let html = runtimeGameRegions(read.value.model, { ...read.value, view: 'desktop' }).selection;
  assert.match(html, /相手のObを1体選択（2\/2）/);
  assert.match(html, /<mark>相手Ob1体に2ダメージ<\/mark>/);
  read = ui.back();
  assert.equal(read.value.stage.index, 0);
  assert.deepEqual(read.value.selection.optionIds, []);
  html = runtimeGameRegions(read.value.model, { ...read.value, view: 'desktop' }).selection;
  assert.match(html, /自分のObを1体選択（1\/2）/);
});

test('a required choice names its source card and the selection lights the clause being resolved', () => {
  const { started, ports, add, play } = flowMatch('STD-163');
  play('a', 'executeSpell', add('a', 'STD-163'));
  assert.deepEqual(ports.a.query().value.requiredInput.source.definitionId, 'STD-163');
  const ui = createMatchUiController({ session: started, viewerSeat: 'a' }).value;
  const read = ui.read().value;
  const html = runtimeGameRegions(read.model, { ...read, view: 'desktop' }).selection;
  // With a single own Ob the pick is made on the board, so the flow floats beside the prompt.
  assert.match(html, /^<aside class="effect-flow"[^]*<mark>自分のObを好きな数破壊する<\/mark>[^]*<aside class="board-pick-guide"/);
});

test('opening protocol v2.4: the HUD shows keep and redraw (an intent has no embedded command) and redraw plans a card pick', () => {
  const created = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: { matchId: 'opening-hud', seatIds: ['player', 'ai'], seed: 5,
    ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode: 'ai', openingProtocol: 'v2.4', playerDeckRecipe: [['STD-020', 40]], aiDeckRecipe: [['STD-020', 40]] } } });
  assert.equal(created.ok, true, JSON.stringify(created));
  const ui = createMatchUiController({ session: created.value, viewerSeat: 'player' }).value;
  const read = ui.read().value;
  const types = read.model.legalActions.map(entry => entry.actionType ?? entry.action?.type);
  assert.deepEqual(types.sort(), ['keepOpeningHand', 'openingMulligan']);
  const html = runtimeGameHtml(read.model, { ...read, view: 'pc', boardStyle: 'wireframe', effectsEnabled: false });
  const extra = html.split('wf-extra-actions')[1] ?? '';
  assert.ok(extra.includes('>キープ</button>') && extra.includes('>引き直し</button>'), 'both opening controls are drawn');
  assert.ok(!html.includes('>keepOpeningHand<') && !html.includes('>openingMulligan<'));
  const mulligan = read.model.legalActions.find(entry => entry.actionType === 'openingMulligan');
  const planned = ui.chooseAction(mulligan.actionId);
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(planned.value.request.presentationKey, 'opening-mulligan');
  assert.equal(planned.value.request.constraints.minimum, 1);
  // The waiting seat sees no opening action at all.
  const waiting = createMatchUiController({ session: created.value, viewerSeat: 'ai' }).value.read().value;
  assert.deepEqual(waiting.model.legalActions, []);
  assert.notEqual(waiting.model.match.activeSeat, 'ai');
});
