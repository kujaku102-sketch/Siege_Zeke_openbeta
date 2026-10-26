import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { canonicalizeCommand } from '../src/game/runtime/command-record.js';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';
import { createMatchUiController } from '../src/adapters/match-ui-controller.js';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { replayMatchRecord } from '../src/adapters/match-replay.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { createTutorialOpponentController } from '../src/adapters/tutorial-opponent-controller.js';
import { mountRuntimeMatch } from '../src/ui-refresh/runtime-match-surface.js';
import { runtimeGameHtml } from '../src/ui-refresh/runtime-read-view.js';
import { runtimeShellHtml } from '../src/ui-refresh/runtime-shell-view.js';

const config = (mode='sandbox',matchId='main-wiring') => ({matchId,seatIds:['a','b'],seed:1,ruleVersion:'rules',cardVersion:'cards',
  gameOptions:mode==='tutorial'
    ? {mode,tutorialId:'basics',playerDeckId:'red',aiDeckId:'yellow',playerUserId:'doors_zx',aiUserId:'doors_zx',
      playerDeckRecipe:null,aiDeckRecipe:null,sandboxDeckSetup:false}
    : {mode,sandboxDeckSetup:mode==='sandbox',playerDeckRecipe:[['STD-020',40]],aiDeckRecipe:[['STD-020',40]]}});
function setup(mode='sandbox') {
  const lifecycle=createMatchLifecycleController({nextMatchId:()=> 'replacement'}),created=lifecycle.start(config(mode));
  assert.equal(created.ok,true,JSON.stringify(created));
  const session=created.value,port=session.port('a').value;
  return {lifecycle,session,port};
}
let serial=0;
function submit(port,action) {
  const query=port.query().value,result=port.submit({commandId:'integration:'+ ++serial,expectedRevision:query.status.revision,action});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.kind,'accepted',JSON.stringify(result));
  return port.query().value;
}
function add(session,port,id) {
  const seatId=port.query().value.status.viewerSeat;
  const query=port.query().value,result=session.sandboxControl('a').value.submit({commandId:'add:'+ ++serial,expectedRevision:query.status.revision,
    action:{type:'sandboxAddCard',definitionId:id,targetSeat:seatId}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.kind,'accepted',JSON.stringify(result));
  return port.query().value.observation.seats.find(seat=>seat.seatId===seatId).hand.cards.findLast(card=>card.definition.id===id).cardRef;
}
function choose(request,predicate=()=>true) {
  const options=[...request.options].sort((a,b)=>Number(predicate(b))-Number(predicate(a))),chosen=[];
  const search=(start,count)=> {
    if(!count){const answer={requestId:request.requestId,optionIds:[...chosen],allocation:[]};return validSelectionAnswer(request,answer)?answer:null;}
    for(let index=start;index<=options.length-count;index+=1){chosen.push(options[index].optionId);const found=search(index+1,count-1);chosen.pop();if(found)return found;}return null;
  };
  for(let count=request.constraints.minimum??0;count<=Math.min(request.constraints.maximum??0,options.length);count+=1){const answer=search(0,count);if(answer)return answer;}
  assert.fail('no valid selection '+request.presentationKey);
}
function plan(port,type,cardRef,predicate) {
  const query=port.query().value,entry=query.legalActions.find(entry=>(entry.actionType??entry.action?.type)===type
    && (!cardRef || (entry.base?.cardRef??entry.base?.attackerRef??entry.action?.cardRef)===cardRef));
  assert.ok(entry,'legal '+type);
  if(entry.kind==='fixed')return entry.action;
  const selections=[];
  for(let stage=0;stage<6;stage+=1){const result=port.queryAction({expectedRevision:query.status.revision,actionId:entry.actionId,selections});
    assert.equal(result.ok,true,JSON.stringify(result));if(result.value.completion)return result.value.completion.action;
    selections.push(choose(result.value.selectionRequests[0],predicate));
  }
  assert.fail('incomplete '+type);
}
function drain(port,predicate) {
  for(let step=0;step<50;step+=1){const input=port.query().value.requiredInput;if(!input)return;
    assert.equal(input.canAnswer,true);
    const answer=choose({...input,requestId:input.choiceId},predicate);
    submit(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:answer.optionIds,allocation:answer.allocation});
  }assert.fail('required input not settled');
}
function fakeRoot() {
  const listeners={};
  return {listeners,childNodes:[],firstChild:null,querySelector:()=>null,querySelectorAll:()=>[],
    ownerDocument:{defaultView:{setTimeout,clearTimeout},createElement:()=>({content:{childNodes:[]},set innerHTML(value){this.html=value;}})},
    addEventListener(type,handler){listeners[type]=handler;},removeEventListener(){}};
}

test('main uses one lifecycle and bound surface, with no raw game/UID/undo fallback',()=>{
  const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.equal((source.match(/createMatchLifecycleController\(/g)??[]).length,1);
  assert.match(source,/mountRuntimeMatch/);assert.match(source,/runtimeShellHtml/);
  assert.doesNotMatch(source,/getState|setState|selectedUid|tutorialUndo|from ['"].*game\/engine|chooseAiAction|applyVisualEffects\(/);
  assert.match(source,/get\('e2e'\) === '1'/);
});
test('surface delegates an end-turn once, and session replacement revokes old handlers and ports',()=>{
  const {lifecycle,session,port}=setup(),root=fakeRoot(),mounted=mountRuntimeMatch({root,session,viewerSeat:'a'});
  assert.equal(mounted.ok,true,JSON.stringify(mounted));
  const entry=port.query().value.legalActions.find(entry=>entry.action?.type==='endTurn');
  const button={dataset:{actionId:entry.actionId},hasAttribute:name=>name==='data-action-id'};
  const event={target:{closest:selector=>selector==='button'?button:null}};
  root.listeners.click(event);assert.equal(port.query().value.status.revision,1);
  const next=lifecycle.rematch();assert.equal(next.ok,true);
  root.listeners.click(event);assert.equal(port.query().ok,false);
  assert.equal(next.value.port('a').value.query().value.status.revision,0);
  lifecycle.dispose();
});
test('a failing decorative step is reported once and does not keep shown events from being acknowledged',()=>{
  const {lifecycle,session,port}=setup(),root=fakeRoot(),errors=[];
  const mounted=mountRuntimeMatch({root,session,viewerSeat:'a',effectsEnabled:true,onError:code=>errors.push(code)});
  assert.equal(mounted.ok,true,JSON.stringify(mounted));
  errors.length=0;
  const entry=port.query().value.legalActions.find(entry=>entry.action?.type==='endTurn');
  const button={dataset:{actionId:entry.actionId},hasAttribute:name=>name==='data-action-id'};
  root.listeners.click({target:{closest:selector=>selector==='button'?button:null}});
  assert.equal(port.query().value.status.revision,1);
  assert.ok(errors.includes('RUNTIME_DECORATION_FAILED'),'the decorative step ran and failed: '+errors.join());
  assert.deepEqual(mounted.value.refresh().value.events,[]);
  lifecycle.dispose();
});
test('a lowGpu surface (iOS WebKit) still delegates input through the same ports',()=>{
  const {lifecycle,session,port}=setup(),root=fakeRoot(),mounted=mountRuntimeMatch({root,session,viewerSeat:'a',lowGpu:true,effectsEnabled:true});
  assert.equal(mounted.ok,true,JSON.stringify(mounted));
  const entry=port.query().value.legalActions.find(entry=>entry.action?.type==='endTurn');
  const button={dataset:{actionId:entry.actionId},hasAttribute:name=>name==='data-action-id'};
  root.listeners.click({target:{closest:selector=>selector==='button'?button:null}});
  assert.equal(port.query().value.status.revision,1);
  lifecycle.dispose();
});
test('normal schema accepts exact generic Target and registry destination, rejects legacy fields/duplicates/getters',()=>{
  const ref='r:'+ 'a'.repeat(32),other='r:'+ 'b'.repeat(32);
  const command=action=>canonicalizeCommand({contractVersion:1,matchId:'m',commandId:'c',actorSeat:'a',expectedRevision:0,action});
  assert.equal(command({type:'executeSpell',cardRef:ref,targets:[{kind:'user',seatId:'b'}],selectionScope:null}).ok,true);
  assert.equal(command({type:'redeploy',cardRef:ref,destination:{zone:'registry'}}).ok,true);
  assert.equal(command({type:'redeploy',cardRef:ref,destination:{zone:'registry',slot:1}}).ok,false);
  assert.equal(command({type:'executeSpell',cardRef:ref,targetRefs:[other],selectionScope:null}).ok,false);
  assert.equal(command({type:'executeSpell',cardRef:ref,targets:[{kind:'card',cardRef:other},{kind:'card',cardRef:other}],selectionScope:null}).ok,false);
  let read=0;const target={kind:'user',get seatId(){read+=1;return 'b';}};
  assert.equal(command({type:'executeSpell',cardRef:ref,targets:[target],selectionScope:null}).ok,false);assert.equal(read,0);
  assert.equal(command({type:'mountCard',cardRef:ref,hostRef:other,mountKind:'belowOb',force:true}).ok,false);
});
test('standalone Code and legal mounted Code use the same staged normal ports without draft mutation',()=>{
  const {lifecycle,session,port}=setup(),ob=port.query().value.observation.seats[0].hand.cards[0].cardRef;
  submit(port,plan(port,'executeCard',ob,option=>option.zone==='front'));
  const code=add(session,port,'SZTB-091'),revision=port.query().value.status.revision;
  const action=plan(port,'executeCard',code,option=>option.hostRef===ob);
  assert.equal(port.query().value.status.revision,revision);
  const query=submit(port,action),host=query.observation.seats[0].front.cards.find(card=>card.cardRef===ob);
  assert.equal(host.mounted[0].definition.id,'SZTB-091');
  const standalone=add(session,port,'SZTB-091');submit(port,plan(port,'executeCard',standalone,option=>option.zone==='back'));
  assert.ok(port.query().value.observation.seats[0].back.cards.some(card=>card.definition.id==='SZTB-091'));
  lifecycle.dispose();
});
test('normal spell preserves generic user target and stale action refuses without a second mutation',()=>{
  const {lifecycle,session,port}=setup(),source=add(session,port,'STD-011');
  const action=plan(port,'executeSpell',source,option=>option.kind==='user');
  assert.deepEqual(action.targets,[{kind:'user',seatId:'b'}]);
  const revision=port.query().value.status.revision;
  const original=port.submit({commandId:'original-spell',expectedRevision:revision,action});
  assert.equal(original.ok,true,JSON.stringify(original));assert.equal(original.value.kind,'accepted');drain(port);
  const settled=port.query().value,settledScope=session.scope();
  assert.ok(port.query().value.observation.seats[0].trash.cards.some(card=>card.definition.id==='STD-011'));
  const retry=port.submit({commandId:'retry-spell',expectedRevision:revision,action});
  assert.deepEqual(retry,original);assert.equal(retry.value.kind,'accepted');
  assert.deepEqual(port.query().value,settled);assert.deepEqual(session.scope(),settledScope);
  const stale=port.submit({commandId:'stale-spell',expectedRevision:revision,action:{type:'endTurn'}});
  assert.equal(stale.ok?stale.value.receipt.reasonCode:stale.error.code,'STALE_REVISION');
  assert.ok(!stale.ok||stale.value.kind==='rejected');
  assert.deepEqual(port.query().value,settled);assert.deepEqual(session.scope(),settledScope);
  lifecycle.dispose();
});
test('native Script remains silhouette; detached owner inspection is temporary and absent from shared/other-seat reads',()=>{
  const {lifecycle,session,port}=setup(),source=add(session,port,'STD-001');
  submit(port,plan(port,'executeCard',source,option=>option.zone==='back'));
  const hidden=port.query().value.observation.seats[0].back.cards.find(card=>card.cardRef===source);
  assert.equal(hidden.faceDown,true);assert.equal(hidden.definition,undefined);
  const inspected=port.query({inspectRef:source});
  assert.equal(inspected.ok,true,JSON.stringify(inspected));assert.equal(inspected.value.inspection.definition.id,'STD-001');
  assert.equal(port.query().value.inspection,undefined);
  const foreign=session.port('b').value.query().value.observation.seats[0].back.cards[0].cardRef;
  assert.equal(session.port('b').value.query({inspectRef:foreign}).ok,false);
  const ui=createMatchUiController({session,viewerSeat:'a'}).value;
  assert.equal(ui.selectCard(source,true).value.inspection.definition.id,'STD-001');
  assert.equal(ui.closeDetail().value.inspection,null);
  ui.selectCard(source,true);submit(port,{type:'endTurn'});
  assert.equal(ui.read().value.inspection,null);
  ui.switchViewer('b');assert.equal(ui.read().value.inspection,null);
  lifecycle.dispose();assert.equal(ui.read().ok,false);
});
test('Ob-as-Script, self executable registry and registry-relog destinations are normal shared plans',()=>{
  const {lifecycle,session,port}=setup();
  const script=add(session,port,'STD-184'),green=add(session,port,'STD-184');submit(port,{type:'install',cardRef:green});submit(port,plan(port,'setScript',script,option=>option.zone==='back'));
  assert.ok(port.query().value.observation.seats[0].back.cards.some(card=>card.faceDown));
  submit(port,{type:'endTurn'});drain(port);const other=session.port('b').value;submit(other,{type:'endTurn'});drain(other);
  const source=add(session,port,'STD-215');submit(port,{type:'install',cardRef:source});drain(port);
  const executed=submit(port,plan(port,'executeRegistry',source,option=>option.zone==='front'));drain(port);
  assert.ok(executed.observation.seats[0].front.cards.some(card=>!card.faceDown&&card.definition.id==='STD-215'));
  const relog=plan(port,'redeploy',source,option=>option.zone==='registry');
  assert.deepEqual(relog.destination,{zone:'registry'});submit(port,relog);drain(port);
  assert.ok(port.query().value.observation.seats[0].registry.cards.some(card=>card.definition.id==='STD-215'));
  lifecycle.dispose();
});
test('card-effect targets and target-zone preserve the exact approved semantic command',()=>{
  const {lifecycle,session,port}=setup(),source=add(session,port,'STD-192'),symbol=add(session,port,'STD-191');
  submit(port,{type:'install',cardRef:symbol});submit(port,plan(port,'executeCard',source,option=>option.zone==='front'));drain(port);
  const ob=port.query().value.observation.seats[0].hand.cards.find(card=>card.definition.id==='STD-020').cardRef;
  submit(port,plan(port,'executeCard',ob,option=>option.zone==='front'));drain(port);
  const action=plan(port,'activateCardEffect',source,option=>option.cardRef===ob||option.zone==='back');
  assert.equal(action.targetZone,'back');assert.deepEqual(action.targets,[{kind:'card',cardRef:ob}]);
  submit(port,action);drain(port);assert.ok(port.query().value.observation.seats[0].back.cards.some(card=>!card.faceDown&&card.cardRef===ob));
  lifecycle.dispose();
});
test('required Back/collapse never undo committed cost and viewer switch removes temporary inspect/log',()=>{
  const {lifecycle,session,port}=setup(),source=add(session,port,'STD-224');submit(port,{type:'install',cardRef:source});
  const ui=createMatchUiController({session,viewerSeat:'a'}).value,read=ui.read().value;
  assert.ok(read.model.requiredInput);const revision=read.model.match.revision,id=read.model.requiredInput.choiceId;
  const after=ui.back().value;assert.equal(after.collapsed,true);assert.equal(after.model.match.revision,revision);assert.equal(after.model.requiredInput.choiceId,id);
  assert.equal(ui.confirm().ok,false);assert.equal(ui.decline().ok,false);
  ui.switchViewer('b');assert.equal(ui.read().value.inspection,null);
  lifecycle.dispose();
});
test('all users retain descriptive unique modal while only legal activated ability receives command control',()=>{
  const {lifecycle,session}=setup(),ui=createMatchUiController({session,viewerSeat:'a'}).value;
  const read=ui.openUnique('b').value,html=runtimeGameHtml(read.model,read);
  assert.match(html,/ユーザー能力/);assert.match(html,/インシデント/);assert.match(html,/data-runtime-unique="a"/);
  assert.doesNotMatch(html,/unique-effect-button is-available/);
  lifecycle.dispose();
});
test('user window and area open a read-only user detail; the ability window stays on UNIQUE EFFECT',()=>{
  const {lifecycle,session}=setup(),ui=createMatchUiController({session,viewerSeat:'a'}).value;
  const closed=ui.read().value,board=runtimeGameHtml(closed.model,{...closed,boardStyle:'wireframe'});
  assert.match(board,/class="wf-user-title" data-runtime-profile="a"/);assert.match(board,/class="wf-avatar" data-runtime-profile="b"/);
  assert.match(board,/data-fortress="b" data-runtime-profile="b"/);assert.match(board,/class="unique-effect[^"]*" data-runtime-unique="a"/);
  assert.match(runtimeGameHtml(closed.model,closed),/compact-fortress" data-runtime-profile="a"/);
  const read=ui.openProfile('b').value,html=runtimeGameHtml(read.model,read),user=read.model.seats[1].user;
  assert.deepEqual([user.initialHand,user.deckRule],[4,null]);assert.equal(Number.isSafeInteger(user.memory),true);
  assert.match(html,/ユーザー詳細/);assert.match(html,/<em>相手<\/em>/);assert.match(html,/UNIQUE EFFECT<\/small><strong>ターボ・ブースト！/);
  for(const label of ['初期STR','メモリ','初期手札','フロント上限','バック上限','デッキ構築ルール'])assert.match(html,new RegExp(`<dt>${label}</dt>`));
  assert.match(html,/<dd class="is-none">なし<\/dd>/);
  assert.equal((html.match(/<li class="ud-str/g)??[]).length,21);assert.match(html,/ud-str is-now"><b>20<\/b>/);
  assert.equal((html.match(/⚠/g)??[]).length,4);
  assert.doesNotMatch(html.slice(html.indexOf('user-detail-modal')),/付与・残数|unique-effect-button|data-action-id/);
  assert.equal(ui.closeProfile().value.profileSeat,null);
  lifecycle.dispose();
});
test('tutorial opponent performs play/pass as individually scheduled normal commands; dispose cancels callbacks',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  walkRedToEndOfTurnOne(session,port,{});drain(port);
  const queue=[],controller=createTutorialOpponentController({session,seatId:'b',scheduler:{schedule:task=>{queue.push(task);return task;},cancel:task=>{const index=queue.indexOf(task);if(index>=0)queue.splice(index,1);}}});
  assert.equal(controller.ok,true);
  controller.value.start();assert.equal(queue.length,1);
  const before=port.query().value.status.revision;queue.shift()();assert.equal(port.query().value.status.revision,before+1);
  for(let index=0;index<10 && queue.length;index+=1)queue.shift()();
  assert.equal(session.tutorial().value.opponentScript,null);
  assert.ok(port.query().value.observation.seats[1].front.cards.some(card=>!card.faceDown&&card.definition.id==='STD-022'&&card.status.sleep),'Guardman stands as the sleeping Security');
  controller.value.dispose();assert.equal(queue.length,0);lifecycle.dispose();
});
test('fresh tutorial skip replaces required choice and invalidates old match actions; premature completion refuses',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  assert.equal(lifecycle.completeTutorial().ok,false);
  const source=port.query().value.observation.seats[0].hand.cards[0].cardRef;
  const next=lifecycle.skipTutorial();assert.equal(next.ok,true);
  assert.equal(port.query().ok,false);
  const current=next.value.port('a').value;
  assert.equal(current.query().value.status.revision,0);assert.equal(current.query().value.requiredInput,null);
  const late=current.submit({commandId:'late',expectedRevision:0,action:{type:'install',cardRef:source}});
  assert.ok(!late.ok||late.value.kind==='rejected');lifecycle.dispose();
});
const seatView=(query,seatId=query.status.viewerSeat)=>query.observation.seats.find(seat=>seat.seatId===seatId);
function answerCurrent(port,predicate) {
  const input=port.query().value.requiredInput;assert.ok(input?.canAnswer);
  const answer=choose({...input,requestId:input.choiceId},predicate);
  return submit(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:answer.optionIds,allocation:answer.allocation});
}
function active(session,port,seatId) {
  const result=session.sandboxControl('a').value.submit({commandId:'active:'+ ++serial,expectedRevision:port.query().value.status.revision,
    action:{type:'sandboxSelectActiveSeat',targetSeat:seatId}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.kind,'accepted',JSON.stringify(result));
}
function assertRefused(port,action,expectedRevision=port.query().value.status.revision) {
  const before=port.query().value,result=port.submit({commandId:'invalid:'+ ++serial,expectedRevision,action});
  assert.ok(!result.ok || result.value.kind==='rejected',JSON.stringify(result));
  assert.deepEqual(port.query().value,before);
}
test('manual answering-viewer switch retains mandatory choice/revision/active seat; active mutation remains busy-denied',()=>{
  const {lifecycle,session,port}=setup(),other=session.port('b').value;
  active(session,port,'b');const source=add(session,other,'STD-224');submit(other,{type:'install',cardRef:source});
  let menuCalls=0;
  const answeringBefore=other.query().value;
  assert.equal(answeringBefore.requiredInput.canAnswer,true);
  const initial=port.query().value,root=fakeRoot(),surface=mountRuntimeMatch({root,session,viewerSeat:'a',onMenu:()=>{menuCalls+=1;}}).value;
  assert.equal(initial.requiredInput.actorSeat,'b');assert.equal(initial.requiredInput.canAnswer,false);
  assert.deepEqual(initial.requiredInput.options,[]);assert.equal(Object.hasOwn(initial.requiredInput,'choiceId'),false);
  const waiting=surface.refresh().value;
  assert.match(runtimeGameHtml(waiting.model,waiting),/相手の選択待ち<\/p><button data-runtime-menu>メニュー<\/button>/);
  // Delegation/markup regression only; fakeRoot does not prove real pointer hit-testing.
  root.listeners.click({target:{closest:selector=>selector==='button'?{hasAttribute:name=>name==='data-runtime-menu'}:null}});
  assert.equal(menuCalls,1);assert.deepEqual(port.query().value,initial);
  const switched=surface.switchViewer('b');assert.equal(switched.ok,true,JSON.stringify(switched));
  const current=other.query().value;
  assert.equal(current.status.revision,initial.status.revision);assert.equal(current.status.activeSeat,initial.status.activeSeat);
  assert.equal(current.requiredInput.choiceId,answeringBefore.requiredInput.choiceId);assert.equal(current.requiredInput.canAnswer,true);
  const denial=session.sandboxControl('a').value.submit({commandId:'busy-active',expectedRevision:current.status.revision,
    action:{type:'sandboxSelectActiveSeat',targetSeat:'a'}});
  assert.ok(!denial.ok||denial.value.kind==='rejected');assert.equal(other.query().value.status.revision,current.status.revision);
  const button=attribute=>({dataset:attribute==='data-option-id'?{optionId:current.requiredInput.options[0].optionId}:{},
    hasAttribute:name=>name===attribute});
  // A single pick answers the required choice on the click itself.
  root.listeners.click({target:{closest:selector=>selector==='button'?button('data-option-id'):null}});
  assert.equal(other.query().value.requiredInput,null);assert.equal(other.query().value.status.revision,current.status.revision+1);
  const html=runtimeShellHtml({screen:'game',mode:'sandbox',view:'pc',options:true,busy:true,actor:'b',activeSeat:'b',opponentControl:'manual',
    savedDecks:[],deckBuilder:{open:false},catalog:{},effectsEnabled:false});
  assert.ok(html.indexOf('data-sandbox-actor')>html.indexOf('</fieldset>'));
  assert.ok(html.indexOf('data-sandbox-active')<html.indexOf('</fieldset>'));
  assert.match(html,/<fieldset disabled>/);
  assert.match(html,/class="r2-modal runtime-host-options/);
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.ok(css.includes('[data-shell-overlays] > .r2-modal.runtime-host-options { z-index:calc(var(--z-modal) + 1); }'));
  const entry=runtimeShellHtml({screen:'entry',mode:'sandbox',view:'pc',options:true,savedDecks:[],deckBuilder:{open:false},catalog:{}});
  assert.doesNotMatch(entry,/runtime-host-options/);lifecycle.dispose();
});
test('public owner/opponent/mounted detail preserves location and complete layer rows without inspection substitution',()=>{
  const {lifecycle,session,port}=setup(),host=seatView(port.query().value).hand.cards[0].cardRef;
  submit(port,plan(port,'executeCard',host,option=>option.zone==='front'));
  const code=add(session,port,'SZTB-091');submit(port,plan(port,'executeCard',code,option=>option.hostRef===host));
  const ui=createMatchUiController({session,viewerSeat:'a'}).value,read=ui.selectCard(host,true).value;
  assert.equal(read.inspection,null);
  const html=runtimeGameHtml(read.model,read);
  assert.match(html,/<dd>front<\/dd>/);assert.match(html,/レイヤー 2/);assert.match(html,/アームズバンド・ジャケット/);
  const mounted=ui.selectCard(code,true).value;assert.equal(mounted.inspection,null);assert.match(runtimeGameHtml(mounted.model,mounted),/mounted/);
  const otherRef=session.port('b').value.query().value.observation.seats[0].front.cards[0].cardRef;
  const foreign=ui.switchViewer('b');assert.equal(foreign.ok,true);
  const detail=ui.selectCard(otherRef,true).value;assert.equal(detail.inspection,null);assert.match(runtimeGameHtml(detail.model,detail),/レイヤー 2/);
  assert.equal(ui.closeDetail().value.model.ui.detailCardRef,null);lifecycle.dispose();
});
test('OC normal port keeps explicit slot/source/resources before choice, pays only accepted +4 and supports manual answering viewer',()=>{
  for(const pay of [false,true]){
    const {lifecycle,session,port}=setup(),actor=pay ? session.port('b').value : port;
    if(pay)active(session,port,'b');
    const symbol=add(session,actor,'STD-125');submit(actor,{type:'install',cardRef:symbol});
    const source=add(session,actor,'STD-125'),before=actor.query().value,memory=seatView(before).memory.current;
    const action=plan(actor,'executeCard',source,option=>option.zone==='front'&&option.slot===3);
    assert.deepEqual(actor.query().value,before);submit(actor,action);
    const waiting=actor.query().value;assert.equal(seatView(waiting).memory.current,memory);
    assert.ok(seatView(waiting).hand.cards.some(card=>card.cardRef===source));assert.equal(seatView(waiting).front.cards.length,0);
    assert.ok(waiting.requiredInput.options.every(option=>option.kind==='value'));
    if(pay){
      const ui=createMatchUiController({session,viewerSeat:'a'}).value;
      assert.equal(ui.read().value.model.requiredInput.canAnswer,false);
      const switched=ui.switchViewer('b').value;assert.equal(switched.model.match.revision,waiting.status.revision);
      assert.equal(switched.model.requiredInput.choiceId,waiting.requiredInput.choiceId);
      const option=switched.request.options.find(option=>option.label==='+4払う');ui.toggleOption(option.optionId);
      assert.equal(actor.query().value.status.revision,waiting.status.revision);assert.equal(ui.confirm().ok,true);
    }else answerCurrent(actor,option=>option.label==='支払わない');
    drain(actor);
    const after=actor.query().value,card=seatView(after).front.cards.find(card=>card.cardRef===source);
    assert.equal(card.location.position,3);assert.equal(seatView(after).memory.current,memory-1-(pay?4:0));
    assert.equal(card.computed.currentAtk,pay?3:1);assert.equal(card.computed.maxStr,pay?3:1);
    lifecycle.dispose();
  }
});
test('magazine normal port confirmation and exact layer continuation retain untouched layers and reject invalid/stale options',()=>{
  for(const accept of [false,true]){
    const {lifecycle,session,port}=setup(),host=seatView(port.query().value).hand.cards[0].cardRef;
    submit(port,plan(port,'executeCard',host,option=>option.zone==='front'));
    const first=add(session,port,'SZTB-091');submit(port,plan(port,'executeCard',first,option=>option.hostRef===host));
    const second=add(session,port,'SZTB-091');submit(port,plan(port,'executeCard',second,option=>option.hostRef===host));
    const source=add(session,port,'SZTB-099'),before=port.query().value,memory=seatView(before).memory.current;
    const action=plan(port,'executeSpell',source);assert.deepEqual(port.query().value,before);submit(port,action);
    let query=port.query().value;assert.equal(seatView(query).memory.current,memory);
    assert.deepEqual(seatView(query).front.cards[0].mounted.map(card=>card.cardRef),[first,second]);
    const oldChoice=query.requiredInput.choiceId;answerCurrent(port,option=>option.label===(accept?'使用する':'使用しない'));
    if(accept){
      query=port.query().value;const input=query.requiredInput;assert.equal(input.constraints.minimum,1);assert.equal(input.constraints.maximum,1);
      assert.equal(seatView(query).memory.current,memory);assert.equal(seatView(query).front.cards[0].mounted.length,2);
      assertRefused(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:[],allocation:[]});
      assertRefused(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:input.options.map(option=>option.optionId),allocation:[]});
      assertRefused(port,{type:'answerChoice',choiceId:oldChoice,optionIds:[],allocation:[]});
      answerCurrent(port,option=>option.cardRef===first);
    }
    drain(port);query=port.query().value;
    assert.equal(seatView(query).memory.current,memory-(accept?2:3));
    assert.deepEqual(seatView(query).front.cards[0].mounted.map(card=>card.cardRef),accept?[second]:[first,second]);
    assert.ok(seatView(query).trash.cards.some(card=>card.definition.id==='SZTB-099'));
    if(accept)assert.ok(seatView(query).trash.cards.some(card=>card.cardRef===first));
    lifecycle.dispose();
  }
});
test('special placement cost normal port rejects hidden/not-distinct/count choices and frees the chosen explicit occupied slot',()=>{
  const {lifecycle,session,port}=setup(),symbol=add(session,port,'STD-118');submit(port,{type:'install',cardRef:symbol});
  const terminals=[];
  for(const [index,id]of ['STD-118','STD-118','STD-119','STD-120'].entries()){
    const ref=add(session,port,id);submit(port,plan(port,'executeCard',ref,option=>option.zone==='back'&&option.slot===index+1));terminals.push(ref);
  }
  const source=add(session,port,'STD-121');
  assert.equal(port.query().value.legalActions.some(entry=>entry.actionType==='executeCard'&&entry.base.cardRef===source),false);
  for(const ref of terminals){submit(port,plan(port,'activateScript',ref));drain(port);}
  const before=port.query().value,memory=seatView(before).memory.current;
  const action=plan(port,'executeCard',source,option=>option.zone==='back'&&option.slot===1);assert.deepEqual(port.query().value,before);submit(port,action);
  const query=port.query().value,input=query.requiredInput;
  assert.ok(seatView(query).hand.cards.some(card=>card.cardRef===source));assert.equal(seatView(query).memory.current,memory);
  assert.equal(seatView(query).back.cards.length,4);
  const optionFor=ref=>input.options.find(option=>option.cardRef===ref).optionId;
  assertRefused(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:[optionFor(terminals[0]),optionFor(terminals[2])],allocation:[]});
  assertRefused(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:[optionFor(terminals[0]),optionFor(terminals[1]),optionFor(terminals[2])],allocation:[]});
  submit(port,{type:'answerChoice',choiceId:input.choiceId,optionIds:[optionFor(terminals[0]),optionFor(terminals[2]),optionFor(terminals[3])],allocation:[]});drain(port);
  const after=port.query().value,placed=seatView(after).back.cards.find(card=>card.cardRef===source);
  assert.equal(placed.faceDown,true);assert.equal(placed.slot,1);assert.equal(seatView(after).memory.current,memory);
  assert.equal(seatView(after).back.cards.length,2);
  for(const ref of [terminals[0],terminals[2],terminals[3]])assert.ok(seatView(after).trash.cards.some(card=>card.cardRef===ref));
  lifecycle.dispose();
});
test('registry Sp normal provider access executes in place once, rejecting same-turn/no-provider/foreign/stale attempts',()=>{
  const lifecycle=createMatchLifecycleController(),runtimeConfig=config();
  runtimeConfig.gameOptions.playerDeckRecipe=[['STD-011',40]];
  const created=lifecycle.start(runtimeConfig);assert.equal(created.ok,true);
  const session=created.value,port=session.port('a').value;
  const symbol=add(session,port,'STD-215');submit(port,{type:'install',cardRef:symbol});
  const provider=add(session,port,'STD-236');submit(port,plan(port,'executeCard',provider,option=>option.zone==='front'));drain(port);
  const before=port.query().value,registry=seatView(before).registry.cards.filter(card=>card.definition.id==='STD-011');
  assert.equal(registry.length,2);
  const action=plan(port,'executeRegistry',registry[0].cardRef,option=>option.kind==='user'&&option.seatId==='b');
  assert.deepEqual(action.placement,{kind:'none'});assert.deepEqual(action.targets,[{kind:'user',seatId:'b'}]);assert.deepEqual(port.query().value,before);
  const original=port.submit({commandId:'original-registry',expectedRevision:before.status.revision,action});
  assert.equal(original.ok,true,JSON.stringify(original));assert.equal(original.value.kind,'accepted');
  drain(port);const after=port.query().value,afterScope=session.scope();
  assert.ok(seatView(after).trash.cards.some(card=>card.cardRef===registry[0].cardRef));
  assert.equal(seatView(after).hand.cards.some(card=>card.cardRef===registry[0].cardRef),false);
  const retry=port.submit({commandId:'retry-registry',expectedRevision:before.status.revision,action});
  assert.deepEqual(retry,original);assert.equal(retry.value.kind,'accepted');
  assert.deepEqual(port.query().value,after);assert.deepEqual(session.scope(),afterScope);
  assertRefused(port,{...action,cardRef:registry[1].cardRef});
  const beforeStale=port.query().value,beforeStaleScope=session.scope();
  const stale=port.submit({commandId:'stale-registry',expectedRevision:before.status.revision,action:{...action,cardRef:registry[1].cardRef}});
  assert.equal(stale.ok?stale.value.receipt.reasonCode:stale.error.code,'STALE_REVISION');
  assert.ok(!stale.ok||stale.value.kind==='rejected');
  assert.deepEqual(port.query().value,beforeStale);assert.deepEqual(session.scope(),beforeStaleScope);
  active(session,port,'b');const foreign=session.port('b').value;
  const ref=foreign.query().value.observation.seats[0].registry.cards.find(card=>card.definition.id==='STD-011').cardRef;
  assertRefused(foreign,{...action,cardRef:ref,targets:[{kind:'user',seatId:'a'}]});lifecycle.dispose();
  const fresh=setup(),noProvider=add(fresh.session,fresh.port,'STD-011');submit(fresh.port,{type:'install',cardRef:noProvider});
  assertRefused(fresh.port,{type:'executeRegistry',cardRef:noProvider,placement:{kind:'none'},targets:[{kind:'user',seatId:'b'}],selectionScope:null});fresh.lifecycle.dispose();
});

// Whole-script tutorial traversal through the real seat ports (no browser): the mode
// controller gates every fresh command and the scripted opponent only sends normal commands.
function visibleCard(query,id,zones) {
  const found=[],visit=card=>{found.push(card);if(!card.faceDown)card.mounted.forEach(visit);};
  for(const zone of zones)seatView(query)[zone].cards.forEach(visit);
  return found.find(card=>!card.faceDown&&card.definition.id===id);
}
function settleTutorial(session,{decline=false}={}) {
  for(let step=0;step<50;step+=1){
    const ports=['a','b'].map(seat=>session.port(seat).value),answering=ports.find(port=>port.query().value.requiredInput?.canAnswer);
    if(!answering){assert.equal(ports[0].query().value.requiredInput,null);return;}
    const input=answering.query().value.requiredInput;
    if(decline&&input.optional)submit(answering,{type:'declineChoice',choiceId:input.choiceId});
    else answerCurrent(answering,option=>option.zone==='front'||option.label?.includes('レイヤー'));
  }
  assert.fail('tutorial required input failed to settle');
}
// The red tutorial (the author's script), up to the end of the first turn: Ob / Code explanations, the soldier,
// the Atto that is refused for want of a symbol, Glenn installed, Atto out, its QA attack and the turn end.
// Steps that only ask the player to look at something (info button, QA badge, detail) are advanced.
function walkRedToEndOfTurnOne(session,port,{stopBeforeEnd=true}={}) {
  const index=()=>session.tutorial().value.flow.index,hand=id=>visibleCard(port.query().value,id,['hand']).cardRef;
  const next=expected=>{assert.equal(session.advanceTutorial().ok,true);assert.equal(index(),expected);};
  for(let count=0;count<8;count+=1)assert.equal(session.advanceTutorial().ok,true);
  assert.equal(index(),1);next(2);
  submit(port,plan(port,'executeCard',hand('STD-021'),option=>option.zone==='front'));assert.equal(index(),3);
  const atto=hand('STD-091');
  const refused=port.submit({commandId:'atto-early:'+ ++serial,expectedRevision:port.query().value.status.revision,action:{type:'executeCard',cardRef:atto,destination:{zone:'front',slot:1}}});
  assert.ok(!refused.ok||refused.value.kind==='rejected','no red symbol yet: Atto cannot come out');
  assert.equal(index(),3);
  next(4);next(5);
  submit(port,plan(port,'install',hand('STD-087')));assert.equal(index(),6);
  next(7);
  submit(port,plan(port,'executeCard',hand('STD-091'),option=>option.zone==='front'));assert.equal(index(),8);
  next(9);
  submit(port,plan(port,'attack',visibleCard(port.query().value,'STD-091',['front']).cardRef,option=>option.kind==='user'));settleTutorial(session);assert.equal(index(),10);
  if(stopBeforeEnd===false)return;
  submit(port,{type:'endTurn'});settleTutorial(session);
}
function runScriptedOpponent(session) {
  const queue=[],created=createTutorialOpponentController({session,seatId:'b',scheduler:{schedule:task=>{queue.push(task);return task;},cancel:task=>{const index=queue.indexOf(task);if(index>=0)queue.splice(index,1);}}});
  assert.equal(created.ok,true,JSON.stringify(created));
  created.value.start();
  for(let count=0;count<40&&queue.length;count+=1)queue.shift()();
  assert.equal(queue.length,0);created.value.dispose();
  assert.equal(session.tutorial().value.opponentScript,null);
}
// After the winning attack the guide shows the closing line with one way on (back to the list), no skip,
// and the match result window stays away: the tutorial ends in its own line.
function assertClosingLine(session,lastIndex,closing=/勝利。/) {
  const flow=session.tutorial().value.flow;
  assert.equal(flow.complete,true);assert.equal(flow.index,lastIndex);
  const ui=createMatchUiController({session,viewerSeat:'a'}).value,read=ui.read().value;
  const html=runtimeGameHtml(read.model,{...read,tutorial:session.tutorial().value});
  assert.match(html,/data-runtime-tutorial-finish/);assert.match(html,closing);
  assert.doesNotMatch(html,/data-runtime-tutorial-skip/);assert.doesNotMatch(html,/r2-result/);
  ui.dispose?.();
}
const refusedFor=(session,port,action,reason)=>{
  const before=port.query().value,result=port.submit({commandId:'guard:'+ ++serial,expectedRevision:before.status.revision,action});
  assert.equal(result.ok,false,JSON.stringify(result));assert.match(result.error.code,/^TUTORIAL_(CHOICE|ACTION)_NOT_EXPECTED$/);
  assert.equal(port.query().value.status.revision,before.status.revision,'nothing changed');
  assert.match(session.tutorial().value.flow.error,reason,'the guide says why');
};
const answerWith=(port,pick)=>{const input=port.query().value.requiredInput,option=input.options.find(pick);assert.ok(option,'option offered');
  return {type:'answerChoice',choiceId:input.choiceId,optionIds:[option.optionId],allocation:[]};};
test('tutorial basics refuses a soldier placed in the back and takes the front',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  for(let index=0;index<9;index+=1)session.advanceTutorial();
  const hand=id=>visibleCard(port.query().value,id,['hand']).cardRef,index=()=>session.tutorial().value.flow.index;
  assert.equal(index(),2);
  const before=port.query().value;
  const result=port.submit({commandId:'guard:'+ ++serial,expectedRevision:before.status.revision,action:plan(port,'executeCard',hand('STD-021'),option=>option.zone==='back')});
  assert.equal(result.ok,false,JSON.stringify(result));assert.match(result.error.code,/^TUTORIAL_ACTION_NOT_EXPECTED$/);
  assert.equal(port.query().value.status.revision,before.status.revision,'nothing changed');
  submit(port,plan(port,'executeCard',hand('STD-021'),option=>option.zone==='front'));assert.equal(index(),3);
  lifecycle.dispose();
});
test('tutorial vengeance refuses the normal relog cost and a wrong effect target, says why, and takes the guided ones',()=>{
  const lifecycle=createMatchLifecycleController({nextMatchId:()=> 'replacement'}),runtime=config('tutorial');runtime.gameOptions.tutorialId='vengeance';
  const session=lifecycle.start(runtime).value,port=session.port('a').value;
  for(let index=0;index<8;index+=1)session.advanceTutorial();
  const hand=id=>visibleCard(port.query().value,id,['hand']).cardRef,index=()=>session.tutorial().value.flow.index;
  submit(port,plan(port,'install',hand('STD-191')));
  submit(port,plan(port,'executeLayered',hand('STD-195'),option=>option.zone==='front'));settleTutorial(session);
  submit(port,plan(port,'redeploy',visibleCard(port.query().value,'STD-195',['front']).cardRef,option=>option.zone==='back'));
  refusedFor(session,port,answerWith(port,option=>option.label==='通常コストを払う'),/レイヤー1枚を破棄/);
  submit(port,answerWith(port,option=>String(option.label).startsWith('レイヤー1枚を破棄')));settleTutorial(session);assert.equal(index(),4);
  submit(port,plan(port,'executeCard',hand('STD-194'),option=>option.zone==='front'));settleTutorial(session);
  submit(port,plan(port,'executeCard',hand('STD-192'),option=>option.zone==='front'));settleTutorial(session);assert.equal(index(),6);
  const source=visibleCard(port.query().value,'STD-192',['front']).cardRef,acroia=visibleCard(port.query().value,'STD-194',['front']).cardRef;
  refusedFor(session,port,plan(port,'activateCardEffect',source,option=>option.cardRef===source||option.zone==='back'),/アクロィア/);
  submit(port,plan(port,'activateCardEffect',source,option=>option.cardRef===acroia||option.zone==='back'));settleTutorial(session);assert.equal(index(),7);
  lifecycle.dispose();
});
test('tutorial red: the Junk Parts go only under Atto; alone in a slot or under the soldier is refused with the reason',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  const index=()=>session.tutorial().value.flow.index,hand=id=>visibleCard(port.query().value,id,['hand']).cardRef;
  walkRedToEndOfTurnOne(session,port);
  runScriptedOpponent(session);assert.equal(index(),11);
  assert.equal(session.advanceTutorial().ok,true);assert.equal(index(),12);
  const atto=visibleCard(port.query().value,'STD-091',['front']).cardRef,soldier=visibleCard(port.query().value,'STD-021',['front']).cardRef;
  // Either way Atto stays at ATK 3 and cannot break the Guardman (STR 4): the script would be stuck.
  refusedFor(session,port,plan(port,'executeCard',hand('STD-078'),option=>option.zone==='front'),/アツト/);
  refusedFor(session,port,plan(port,'executeCard',hand('STD-078'),option=>option.hostRef===soldier||option.cardRef===soldier),/アツト/);
  submit(port,plan(port,'executeCard',hand('STD-078'),option=>option.hostRef===atto||option.cardRef===atto));settleTutorial(session);
  assert.equal(index(),13);assert.equal(session.tutorial().value.flow.error,'');
  lifecycle.dispose();
});
test('tutorial red step 3: Atto\'s blocked play stays pressable in its popup, names the missing symbol, and the step moves on',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  const index=()=>session.tutorial().value.flow.index,hand=id=>visibleCard(port.query().value,id,['hand']).cardRef;
  for(let count=0;count<9;count+=1)assert.equal(session.advanceTutorial().ok,true);
  submit(port,plan(port,'executeCard',hand('STD-021'),option=>option.zone==='front'));assert.equal(index(),3);
  const ui=createMatchUiController({session,viewerSeat:'a'}).value;
  ui.selectCard(hand('STD-091'));
  const read=ui.read().value,html=runtimeGameHtml(read.model,{...read,tutorial:session.tutorial().value});
  assert.match(html,/<aside class="r2-popup" aria-label="カード操作" data-card-id="STD-091">/);
  assert.match(html,/<button aria-disabled="true" data-tutorial-try="SYMBOL_MISSING" data-route="executeCard" data-block-code="SYMBOL_MISSING" title="シンボル不足で実行できません">実行<\/button>/);
  // The same card outside such a step is plainly disabled.
  const later=runtimeGameHtml(read.model,{...read,tutorial:{...session.tutorial().value,presentation:{...session.tutorial().value.presentation,focus:[]}}});
  assert.match(later,/<button disabled aria-disabled="true" data-route="executeCard" data-block-code="SYMBOL_MISSING"/);
  assert.equal(session.advanceTutorial().ok,true,'the press moves the step on');assert.equal(index(),4);
  // The reason shows as a line in the guide (the surface holds it as the step's note).
  const moved=ui.read().value,noted={...session.tutorial().value,note:'シンボル不足で実行できません'};
  assert.match(runtimeGameHtml(moved.model,{...moved,tutorial:noted}),/<p class="live-guide-error" role="alert">シンボル不足で実行できません<\/p>/);
  assert.doesNotMatch(runtimeGameHtml(moved.model,{...moved,tutorial:session.tutorial().value}),/live-guide-error/,'no note, no line');
  ui.dispose?.();lifecycle.dispose();
});
test('guide pages: [次へ] turns pages, [戻る] after the first, the step\'s own button and its highlights only on the last page',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  for(let count=0;count<8;count+=1)assert.equal(session.advanceTutorial().ok,true);
  const ui=createMatchUiController({session,viewerSeat:'a'}).value,read=ui.read().value,value=session.tutorial().value;
  assert.equal(value.presentation.expect.type,'advance');
  const html=page=>runtimeGameHtml(read.model,{...read,tutorial:{...value,page}});
  const first=html({index:0,count:3,text:'一枚目。',last:false,pending:false});
  assert.match(first,/<p>一枚目。<\/p>/);
  assert.match(first,/<small class="live-guide-page" aria-label="1ページ目／全3ページ">1\/3<\/small>/);
  assert.match(first,/data-runtime-guide-next>次へ ▸<\/button>/);
  assert.doesNotMatch(first,/data-runtime-guide-prev|data-runtime-tutorial-next/,'no back on the first page, no step move before the last');
  const middle=html({index:1,count:3,text:'二枚目。',last:false,pending:false});
  assert.match(middle,/data-runtime-guide-prev>◂ 戻る<\/button><button class="live-guide-next" data-runtime-guide-next>/);
  const last=html({index:2,count:3,text:'三枚目。',last:true,pending:false});
  assert.match(last,/data-runtime-guide-prev>◂ 戻る<\/button><button class="live-guide-next" data-runtime-tutorial-next>次へ ▸<\/button>/);
  assert.match(last,/data-guide-page="3\/3"/);
  const single=runtimeGameHtml(read.model,{...read,tutorial:value});
  assert.doesNotMatch(single,/live-guide-page|data-runtime-guide-(next|prev)/,'one page: no number, no page buttons');
  assert.match(single,/aria-live="polite"/);
  const pending=html({index:0,count:1,text:value.presentation.text,last:false,pending:true});
  assert.match(pending,/data-paging="pending"/);assert.doesNotMatch(pending,/data-runtime-guide-next|data-runtime-tutorial-next/,'nothing to press until the pages are cut');
  ui.dispose?.();lifecycle.dispose();
});
test('tutorial basics runs start to finish through ports: the script ends with opponent STR 5 to 0 as a locked win, with scripted opponent and no undo',()=>{
  const {lifecycle,session,port}=setup('tutorial');
  const index=()=>session.tutorial().value.flow.index,hand=id=>visibleCard(port.query().value,id,['hand']).cardRef;
  walkRedToEndOfTurnOne(session,port);
  runScriptedOpponent(session);assert.equal(index(),11);
  const seat=seatView(port.query().value);
  assert.equal(seatView(port.query().value,'b').front.cards.find(card=>card.definition.id==='STD-022').status.sleep,true);
  assert.equal(session.advanceTutorial().ok,true);assert.equal(index(),12);
  const atto=visibleCard(port.query().value,'STD-091',['front']).cardRef;
  submit(port,plan(port,'executeCard',hand('STD-078'),option=>option.hostRef===atto||option.cardRef===atto));settleTutorial(session);assert.equal(index(),13);
  const guardman=seatView(port.query().value,'b').front.cards.find(card=>!card.faceDown&&card.definition.id==='STD-022').cardRef;
  submit(port,plan(port,'attack',atto,option=>option.cardRef===guardman));settleTutorial(session);assert.equal(index(),14);
  assert.equal(port.query().value.status.finished,false);
  assert.equal(session.advanceTutorial().ok,true);assert.equal(index(),15);
  assert.ok(seat);
  submit(port,plan(port,'attack',visibleCard(port.query().value,'STD-021',['front']).cardRef,option=>option.kind==='user'));
  const done=port.query().value;
  assert.ok(done.status.lockedOutcome||done.status.finished,'reaching STR 0 locks the result');
  assert.equal(done.status.lockedOutcome.winnerSeat,'a');
  assertClosingLine(session,16,/勝利です/);
  lifecycle.dispose();
});
test('tutorial vengeance runs start to finish through ports: relogged layered Ob and generated Dolls take opponent STR 5 to 0',()=>{
  const lifecycle=createMatchLifecycleController({nextMatchId:()=> 'replacement'}),runtime=config('tutorial');runtime.gameOptions.tutorialId='vengeance';
  const created=lifecycle.start(runtime);assert.equal(created.ok,true,JSON.stringify(created));
  const session=created.value,port=session.port('a').value;
  for(let index=0;index<8;index+=1)assert.equal(session.advanceTutorial().ok,true);
  const index=()=>session.tutorial().value.flow.index,hand=id=>visibleCard(port.query().value,id,['hand']).cardRef;
  submit(port,plan(port,'install',hand('STD-191')));assert.equal(index(),2);
  submit(port,plan(port,'executeLayered',hand('STD-195'),option=>option.zone==='front'));settleTutorial(session);assert.equal(index(),3);
  submit(port,plan(port,'redeploy',visibleCard(port.query().value,'STD-195',['front']).cardRef,option=>option.zone==='back'));settleTutorial(session);assert.equal(index(),4);
  submit(port,plan(port,'executeCard',hand('STD-194'),option=>option.zone==='front'));settleTutorial(session);assert.equal(index(),5);
  submit(port,plan(port,'executeCard',hand('STD-192'),option=>option.zone==='front'));settleTutorial(session);assert.equal(index(),6);
  const source=visibleCard(port.query().value,'STD-192',['front']).cardRef,moved=visibleCard(port.query().value,'STD-194',['front']).cardRef;
  submit(port,plan(port,'activateCardEffect',source,option=>option.cardRef===moved||option.zone==='back'));settleTutorial(session);assert.equal(index(),7);
  submit(port,{type:'endTurn'});settleTutorial(session);runScriptedOpponent(session);assert.equal(index(),8);
  submit(port,plan(port,'redeploy',visibleCard(port.query().value,'STD-195',['back']).cardRef,option=>option.zone==='front'));settleTutorial(session);assert.equal(index(),9);
  submit(port,plan(port,'attack',visibleCard(port.query().value,'STD-195',['front']).cardRef,option=>option.kind==='user'));settleTutorial(session);assert.equal(index(),10);
  assert.equal(port.query().value.status.finished,false);
  submit(port,plan(port,'attack',visibleCard(port.query().value,'STD-189',['front']).cardRef,option=>option.kind==='user'));
  const done=port.query().value;
  assert.ok(done.status.lockedOutcome||done.status.finished,'reaching STR 0 locks the result');
  assertClosingLine(session,11);
  lifecycle.dispose();
});

function userMatch(userId,mode='ai') {
  const runtime=config(mode);Object.assign(runtime.gameOptions,{playerUserId:userId,aiUserId:'doors_zx'});
  const lifecycle=createMatchLifecycleController({nextMatchId:()=> 'replacement'}),created=lifecycle.start(runtime);
  assert.equal(created.ok,true,JSON.stringify(created));
  return {lifecycle,session:created.value,port:created.value.port('a').value};
}
const legalTypes=query=>query.legalActions.map(entry=>entry.action?.type??entry.actionType);
test('opening mulligan is a normal fixed port action: redraws once per use, stops at the cap and after any other move',()=>{
  const {lifecycle,port}=userMatch('bigboss');
  for(let used=1;used<=3;used+=1){
    const query=port.query().value,entry=query.legalActions.find(entry=>entry.action?.type==='openingMulligan');
    assert.ok(entry,'mulligan '+used);
    const before=seatView(query).hand.cards.map(card=>card.cardRef),after=submit(port,entry.action);
    assert.equal(seatView(after).hand.cards.length,before.length);
  }
  assert.equal(legalTypes(port.query().value).includes('openingMulligan'),false);
  lifecycle.dispose();
  const second=userMatch('bigboss');
  submit(second.port,{type:'endTurn'});
  assertRefused(second.session.port('a').value,{type:'openingMulligan'});
  second.lifecycle.dispose();
  const other=userMatch('doors_zx');
  assert.equal(legalTypes(other.port.query().value).includes('openingMulligan'),false);
  assertRefused(other.port,{type:'openingMulligan'});other.lifecycle.dispose();
});
test('user ability activation is a fixed port action that is offered once and spent',()=>{
  const {lifecycle,port}=userMatch('doors_zx');
  const entry=port.query().value.legalActions.find(entry=>entry.action?.type==='activateAbility');
  assert.ok(entry);assert.deepEqual(entry.action.ability,{kind:'user',key:'turbo'});
  const memory=seatView(port.query().value).memory.current,after=submit(port,entry.action);
  assert.ok(seatView(after).memory.current>=memory);
  assert.equal(legalTypes(after).includes('activateAbility'),false);
  assertRefused(port,entry.action);lifecycle.dispose();
});
test('registry recovery is a fixed port action tied to the once-per-turn registry action',()=>{
  const {lifecycle,session,port}=setup(),card=add(session,port,'STD-020');
  submit(port,{type:'install',cardRef:card});
  assert.equal(legalTypes(port.query().value).some(type=>type==='install'||type==='recoverRegistry'),false);
  submit(port,{type:'endTurn'});drain(port);const other=session.port('b').value;submit(other,{type:'endTurn'});drain(other);
  const query=port.query().value,registry=seatView(query).registry.cards[0],entry=query.legalActions.find(entry=>entry.action?.type==='recoverRegistry'&&entry.action.cardRef===registry.cardRef);
  assert.ok(entry);
  const after=submit(port,entry.action);drain(port);
  assert.equal(seatView(port.query().value).registry.cards.some(item=>item.cardRef===registry.cardRef),false);
  assert.equal(legalTypes(port.query().value).includes('recoverRegistry'),false);
  lifecycle.dispose();
});

// Stage05 12.1 source boundary: the player-facing layers (main, adapters, UI) never reach the
// engine, the legacy AI or raw match state. Known exceptions are listed so a new one fails.
const productionSources = dir => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? productionSources(dir + entry.name + '/') : /\.js$/.test(entry.name) ? [dir + entry.name] : []);
const playerFacingSources = () => ['../src/main.js', ...productionSources('../src/adapters/'), ...productionSources('../src/ui-refresh/'), ...productionSources('../src/ui/')];
const SOURCE_EXCEPTIONS = new Map([
  ['../src/adapters/match-log.js', ['game/engine.js']], // static DECK_OPTIONS labels only
  ['../src/ui/visual-effects.js', ['game/engine.js']]]); // card stat helpers; to move onto the read model
test('player-facing sources import no engine, legacy AI or selection model beyond the pure public helpers', () => {
  const allowed = new Set(['game/runtime/selection-contract.js', 'game/deck-builder.js', 'game/card-types.js']);
  const found = [];
  for (const file of playerFacingSources()) {
    const base = new URL(file, import.meta.url), text = readFileSync(base, 'utf8');
    for (const [, specifier] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (!specifier.startsWith('.')) continue;
      const target = new URL(specifier, base).href.split('/src/')[1];
      const trustedRuntime = file.startsWith('../src/adapters/') && target.startsWith('game/runtime/'); // port/session factories bind the runtime
      if (target.startsWith('game/') && !allowed.has(target) && !trustedRuntime && !SOURCE_EXCEPTIONS.get(file)?.includes(target)) found.push(file + ' -> ' + target);
    }
  }
  assert.deepEqual(found, []);
  for (const [file, targets] of SOURCE_EXCEPTIONS) for (const target of targets)
    assert.ok(readFileSync(new URL(file, import.meta.url), 'utf8').includes(target), file + ' no longer needs its exception');
});
test('player-facing sources hold no raw match state, no undo and no legacy AI iterator', () => {
  const forbidden = /state\.(pending|prompt)\b|state\.(active|mode)\s*=[^=]|\.sandboxUi\s*=[^=]|\bgetState\b|\bsetState\b|\bundo\(|runSimpleAiTurn|resolveAutomatedAiChoices|\bselectedUid\s*=[^=]/;
  assert.deepEqual(playerFacingSources().filter(file => forbidden.test(readFileSync(new URL(file, import.meta.url), 'utf8'))), []);
});

// Opening protocol v2.4: each user decides in seat order before the first turn; the last decision rolls the dice.
const openingMatch = (seed = 7, options = {}) => {
  const created = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: { matchId: 'opening-' + seed, seatIds: ['a', 'b'], seed,
    ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode: 'ai', openingProtocol: 'v2.4', playerDeckRecipe: [['STD-020', 40]], aiDeckRecipe: [['STD-020', 40]], ...options } } });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
};
const OPENING_V24 = { openingProtocol: 'v2.4' };
const handRefs = query => seatView(query).hand.cards.map(card => card.cardRef);
function pickCards(port, count) {
  const query = port.query().value, entry = query.legalActions.find(item => item.actionType === 'openingMulligan');
  assert.ok(entry, 'mulligan intent');
  const first = port.queryAction({ expectedRevision: query.status.revision, actionId: entry.actionId, selections: [] });
  assert.equal(first.ok, true, JSON.stringify(first));
  const request = first.value.selectionRequests[0];
  assert.equal(request.presentationKey, 'opening-mulligan');
  const answer = { requestId: request.requestId, optionIds: request.options.slice(0, count).map(option => option.optionId), allocation: [] };
  const done = port.queryAction({ expectedRevision: query.status.revision, actionId: entry.actionId, selections: [answer] });
  assert.equal(done.ok, true, JSON.stringify(done));
  return { request, action: done.value.completion.action };
}
test('v2.4 opening: seat order, partial mulligan returns the chosen cards, dice start the first turn', () => {
  const session = openingMatch(), a = session.port('a').value, b = session.port('b').value;
  try {
    const start = a.query().value;
    assert.equal(start.status.activeSeat, 'a');
    assert.deepEqual(legalTypes(start).sort(), ['keepOpeningHand', 'openingMulligan']);
    assert.equal(seatView(start).hand.cards.length, 4);
    assert.deepEqual(b.query().value.legalActions, []);
    assertRefused(b, { type: 'keepOpeningHand' });
    assertRefused(a, { type: 'endTurn' });
    assertRefused(a, { type: 'install', cardRef: handRefs(start)[0] });
    const { request, action } = pickCards(a, 2);
    assert.equal(request.constraints.minimum, 1);
    assert.equal(request.constraints.maximum, 4);
    assert.equal(action.cardRefs.length, 2);
    const before = handRefs(start);
    const after = submit(a, action);
    assert.equal(seatView(after).hand.cards.length, 4);
    assert.equal(action.cardRefs.some(ref => handRefs(after).includes(ref)), false, 'returned cards left the hand');
    assert.equal(handRefs(after).filter(ref => before.includes(ref)).length >= 2, true, 'kept cards keep their refs');
    assertRefused(a, action, after.status.revision);
    assert.equal(after.status.activeSeat, 'b');
    assert.deepEqual(legalTypes(a.query().value), []);
    assert.equal(seatView(b.query().value, 'a').hand.count, 4);
    // The second user keeps; the dice then decide who plays turn 1.
    const second = submit(b, { type: 'keepOpeningHand' });
    assert.equal(second.observation.turnNumber, 1);
    assert.equal(legalTypes(second).includes('keepOpeningHand') || legalTypes(second).includes('openingMulligan'), false);
    const firstSeat = second.status.activeSeat;
    assert.ok(['a', 'b'].includes(firstSeat));
    assert.ok(legalTypes((firstSeat === 'a' ? a : b).query().value).includes('endTurn'));
    assertRefused(a, { type: 'openingMulligan', cardRefs: [handRefs(a.query().value)[0]] });
  } finally { session.dispose(); }
});
test('v2.4 opening: other users learn only that a decision happened, and the same seed gives the same start', () => {
  const run = keep => {
    const session = openingMatch(11), a = session.port('a').value, b = session.port('b').value;
    submit(a, keep ? { type: 'keepOpeningHand' } : pickCards(a, 1).action);
    const events = b.events({ afterEventId: null }).value.events.filter(event => event.type === 'action_committed');
    const result = { actions: events.map(event => event.actionType), view: JSON.stringify(b.query().value.observation).replace(/r:[0-9a-f]{32}/g, 'ref') };
    submit(b, { type: 'keepOpeningHand' });
    result.first = b.query().value.status.activeSeat;
    session.dispose();
    return result;
  };
  const kept = run(true), redrew = run(false), again = run(true);
  assert.deepEqual(kept.actions, ['openingDecision']);
  assert.deepEqual(redrew.actions, ['openingDecision']);
  assert.equal(kept.first, again.first);
  assert.equal(kept.view, again.view);
});
test('v2.4 opening: each user decides once, and BIGBOSS up to three times with a keep at any point', () => {
  const session = openingMatch(5, { ...OPENING_V24, playerUserId: 'bigboss', playerDeckRecipe: [['STD-020', 50]] });
  const a = session.port('a').value;
  try {
    for (let used = 1; used <= 2; used += 1) { submit(a, pickCards(a, 1).action); assert.equal(a.query().value.status.activeSeat, 'a'); }
    submit(a, { type: 'keepOpeningHand' });
    assert.equal(a.query().value.status.activeSeat, 'b');
  } finally { session.dispose(); }
  const single = openingMatch(5, OPENING_V24), one = single.port('a').value;
  try { submit(one, pickCards(one, 1).action); assert.equal(one.query().value.status.activeSeat, 'b'); } finally { single.dispose(); }
});
test('opening forms are bound to the match protocol, so legacy records keep their meaning', () => {
  const legacy = openingMatch(3, { openingProtocol: 'legacy', playerUserId: 'bigboss', playerDeckRecipe: [['STD-020', 50]] }), port = legacy.port('a').value;
  try {
    assert.equal(legalTypes(port.query().value).includes('keepOpeningHand'), false);
    assertRefused(port, { type: 'keepOpeningHand' });
    assertRefused(port, { type: 'openingMulligan', cardRefs: [handRefs(port.query().value)[0]] });
    submit(port, { type: 'openingMulligan' });
  } finally { legacy.dispose(); }
  const modern = openingMatch(3, { ...OPENING_V24, playerUserId: 'bigboss', playerDeckRecipe: [['STD-020', 50]] }), v24 = modern.port('a').value;
  try { assertRefused(v24, { type: 'openingMulligan' }); } finally { modern.dispose(); }
  for (const options of [{ ...OPENING_V24, mode: 'sandbox' }, { openingProtocol: 'v3' }, { openingProtocol: undefined }]) {
    assert.equal(createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: { matchId: 'bad', seatIds: ['a', 'b'], seed: 1,
      ruleVersion: 'rules', cardVersion: 'cards', gameOptions: options } }).ok, false);
  }
  const plain = openingMatch(3, { openingProtocol: 'legacy' });
  assert.equal(Object.hasOwn(plain.matchRecord().value.game.gameOptions, 'openingProtocol'), false);
  plain.dispose();
});
test('a v2.4 match record replays its opening decisions to the same state', () => {
  const session = openingMatch(21, OPENING_V24), a = session.port('a').value, b = session.port('b').value;
  try {
    submit(a, pickCards(a, 3).action);
    submit(b, { type: 'keepOpeningHand' });
    const active = [a, b].find(port => port.query().value.status.activeSeat === port.query().value.status.viewerSeat);
    submit(active, { type: 'endTurn' });
    drain(active);
    const record = session.matchRecord();
    assert.equal(record.ok, true, JSON.stringify(record));
    assert.equal(record.value.game.gameOptions.openingProtocol, 'v2.4');
    assert.equal(JSON.stringify(record.value.commands).includes('r:'), false);
    const replayed = replayMatchRecord(JSON.parse(JSON.stringify(record.value)));
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(replayed.value.revision, active.query().value.status.revision);
    assert.equal(replayed.value.engineState.firstPlayer, replayMatchRecord(record.value).value.engineState.firstPlayer);
  } finally { session.dispose(); }
});
test('two CPU controllers pass the v2.4 opening by keeping, then play and replay the same match', () => {
  const session = openingMatch(33, { playerDeckRecipe: null, aiDeckRecipe: null, playerDeckId: 'red', aiDeckId: 'yellow' });
  try {
    let serial = 0;
    for (let step = 0; step < 60; step += 1) {
      let port = session.port('a').value, query = port.query().value;
      if (query.status.finished) break;
      if (query.requiredInput ? !query.requiredInput.canAnswer : query.status.activeSeat !== 'a') { port = session.port('b').value; query = port.query().value; }
      const intent = chooseSimpleAiIntent(query, 'cpu:' + ++serial, input => port.queryAction(input));
      assert.equal(intent.ok, true, step + ' ' + JSON.stringify(intent));
      if (step < 2) assert.equal(intent.value.action.type, 'keepOpeningHand');
      assert.equal(port.submit(intent.value).ok, true);
    }
    const record = session.matchRecord();
    assert.equal(replayMatchRecord(JSON.parse(JSON.stringify(record.value))).value.revision, session.port('a').value.query().value.status.revision);
  } finally { session.dispose(); }
});
