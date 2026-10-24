import test from 'node:test';
import assert from 'node:assert/strict';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';

const config = (mode='sandbox',matchId='route-rules') => ({matchId,seatIds:['a','b'],seed:1,ruleVersion:'rules',cardVersion:'cards',
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

const seatView = query => query.observation.seats.find(seat => seat.seatId === query.status.viewerSeat);
const typeOf = entry => entry.actionType ?? entry.action?.type;
const boardCard = (query, cardRef) => [...seatView(query).front.cards, ...seatView(query).back.cards].find(card => card.cardRef === cardRef);
const canAttackWith = (query, cardRef) => query.legalActions.some(entry => typeOf(entry) === 'attack' && entry.base?.attackerRef === cardRef);

test('hand execution lists Codes to stack on; there is no separate mount route', () => {
  const { lifecycle, session, port } = setup();
  const code = add(session, port, 'SZTB-091');
  submit(port, plan(port, 'executeCard', code, option => option.zone === 'back'));
  const ob = add(session, port, 'STD-020');
  const query = port.query().value;
  assert.equal(query.legalActions.some(entry => typeOf(entry) === 'mountCard'), false);
  const action = plan(port, 'executeCard', ob, option => option.hostRef === code);
  assert.deepEqual(action, { type: 'mountCard', cardRef: ob, hostRef: code, mountKind: 'aboveCode' });
  const after = submit(port, action);
  assert.deepEqual(boardCard(after, ob).mounted.map(card => card.cardRef), [code]);
  lifecycle.dispose();
});

test('re-execution can go onto a Code in the other area and keeps the Code as a layer', () => {
  const { lifecycle, session, port } = setup();
  const ob = add(session, port, 'STD-020');
  submit(port, plan(port, 'executeCard', ob, option => option.zone === 'front'));
  const code = add(session, port, 'SZTB-091');
  submit(port, plan(port, 'executeCard', code, option => option.zone === 'back'));
  const action = plan(port, 'redeploy', ob, option => option.hostRef === code);
  assert.deepEqual(action.destination, { zone: 'back', hostRef: code });
  const after = submit(port, action);
  const moved = seatView(after).back.cards.find(card => card.cardRef === ob);
  assert.ok(moved);
  assert.deepEqual(moved.mounted.map(card => card.cardRef), [code]);
  assert.equal(seatView(after).front.cards.some(card => card.cardRef === ob), false);
  lifecycle.dispose();
});

test('re-execution to the front keeps summoning sickness tied to the turn the Ob entered the field', () => {
  const { lifecycle, session, port } = setup();
  const veteran = add(session, port, 'STD-020');
  submit(port, plan(port, 'executeCard', veteran, option => option.zone === 'back'));
  submit(port, { type: 'endTurn' });
  if (port.query().value.status.activeSeat !== 'a') submit(session.port('b').value, { type: 'endTurn' });
  assert.equal(port.query().value.status.activeSeat, 'a');
  const rookie = add(session, port, 'STD-020');
  submit(port, plan(port, 'executeCard', rookie, option => option.zone === 'back'));
  submit(port, plan(port, 'redeploy', veteran, option => option.zone === 'front'));
  let query = submit(port, plan(port, 'redeploy', rookie, option => option.zone === 'front'));
  assert.equal(canAttackWith(query, veteran), true, 'an Ob from an earlier turn can attack after moving to the front');
  assert.equal(canAttackWith(query, rookie), false, 'an Ob that entered this turn still cannot attack');
  assert.equal(boardCard(query, rookie).status.summoningSick, true);
  assert.equal(Object.hasOwn(boardCard(query, veteran), 'fieldEntryTurn'), false);
  lifecycle.dispose();
});

test('resting the last ready Security carries the turn end on instead of asking again', () => {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'security-rest-pick', seatIds: ['self', 'enemy'], seed: 11, ruleVersion: '2.0', cardVersion: 'public',
    gameOptions: { mode: 'ai', playerUserId: 'doors_zx', aiUserId: 'doors_zx',
      playerDeckRecipe: [['STD-043', 30]], aiDeckRecipe: [['STD-044', 30]] } } });
  assert.equal(made.ok, true, JSON.stringify(made));
  const session = made.value, port = session.port('self').value;
  try {
    const guard = seatView(port.query().value).hand.cards[0].cardRef;
    submit(port, plan(port, 'executeCard', guard, option => option.zone === 'front'));
    let query = submit(port, { type: 'endTurn' });
    const input = query.requiredInput;
    assert.equal(input.presentationKey, 'security-rest');
    query = submit(port, { type: 'answerChoice', choiceId: input.choiceId,
      optionIds: [input.options.find(option => option.cardRef === guard).optionId], allocation: [] });
    assert.equal(query.requiredInput, null);
    assert.equal(query.status.activeSeat, 'enemy');
    assert.equal(boardCard(query, guard).status.sleep, true);
  } finally { session.dispose(); }
});

test('the CPU rests one ready Security at turn end and lets the rest stay on standby', () => {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'security-rest-cpu', seatIds: ['self', 'enemy'], seed: 11, ruleVersion: '2.0', cardVersion: 'public',
    gameOptions: { mode: 'ai', playerUserId: 'doors_zx', aiUserId: 'doors_zx',
      playerDeckRecipe: [['STD-043', 30]], aiDeckRecipe: [['STD-044', 30]] } } });
  assert.equal(made.ok, true, JSON.stringify(made));
  const session = made.value, port = session.port('self').value;
  const cpu = () => {
    const intent = chooseSimpleAiIntent(port.query().value, 'cpu:' + ++serial, input => port.queryAction(input));
    assert.equal(intent.ok, true, JSON.stringify(intent));
    const result = port.submit(intent.value);
    assert.equal(result.ok, true, JSON.stringify(result));
    return intent.value.action;
  };
  try {
    const [first, second] = seatView(port.query().value).hand.cards.map(card => card.cardRef);
    submit(port, plan(port, 'executeCard', first, option => option.zone === 'front'));
    submit(port, plan(port, 'executeCard', second, option => option.zone === 'front'));
    submit(port, { type: 'endTurn' });
    assert.equal(port.query().value.requiredInput.presentationKey, 'security-rest');
    assert.equal(cpu().type, 'answerChoice');
    assert.equal(port.query().value.requiredInput.presentationKey, 'security-rest');
    assert.equal(cpu().type, 'declineChoice');
    const query = port.query().value;
    assert.equal(query.requiredInput, null);
    assert.equal(query.status.activeSeat, 'enemy');
    assert.deepEqual([first, second].map(ref => boardCard(query, ref).status.sleep).sort(), [false, true]);
  } finally { session.dispose(); }
});
