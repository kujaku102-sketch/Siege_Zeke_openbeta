import test from 'node:test';
import assert from 'node:assert/strict';
import { planBattleEffects, createBattleFx } from '../src/ui-refresh/wireframe/battle-fx.js';
import { CELL_PATHS, CELLS, memoryMeterModel, memoryMeterHtml, spentCells } from '../src/ui-refresh/wireframe/memory-meter.js';

const r={left:10,top:20,width:80,height:120};
const a=new Map([['a',r],['b',{...r,left:200}],['user:p2',{...r,top:0}],['hud:p2',{...r,left:500}]]);
test('actual damage is shown once per damaged card, not again for combat summary',()=>{
  const cues=planBattleEffects([
    {type:'combat_resolved',source:{cardRef:'a'},target:{cardRef:'b'},damage:3,counterDamage:2},
    {type:'card_damaged',target:{cardRef:'b'},amount:3},
    {type:'card_damaged',target:{cardRef:'a'},amount:2},
  ],a,a);
  assert.deepEqual(cues.map(c=>c.amount),[3,2]);
});
test('destruction keeps old geometry after removal, movement alone never shatters',()=>{
  const cues=planBattleEffects([
    {type:'card_moved',target:{cardRef:'a'},from:{kind:'board'},to:{kind:'trash'}},
    {type:'card_destroyed',target:{cardRef:'a',name:'private name',cardId:'private id'}},
  ],a,new Map());
  assert.deepEqual(cues,[{kind:'destroy',at:r}]);
  assert.ok(!JSON.stringify(cues).includes('private'));
});
test('entry into board animates; board relocation and unmounted cards do not',()=>{
  assert.deepEqual(planBattleEffects([
    {type:'card_moved',target:{cardRef:'a'},from:{kind:'hand'},to:{kind:'board'}},
    {type:'card_moved',target:{cardRef:'b'},from:{kind:'board'},to:{kind:'board'}},
    {type:'card_destroyed',target:{cardRef:'hidden'}},
  ],new Map(),a),[{kind:'deploy',at:r}]);
});
test('user attack travels to rear target, user damage appears over status HUD',()=>{
  const cues=planBattleEffects([
    {type:'attack_declared',source:{cardRef:'a'},target:{kind:'user',seatId:'p2'}},
    {type:'user_damaged',target:{seatId:'p2'},amount:4},
    {type:'card_damaged',target:{cardRef:'a'},amount:NaN},
  ],a,a);
  assert.equal(cues[0].to,a.get('user:p2')); assert.equal(cues[1].at,a.get('hud:p2'));
  assert.equal(cues.length,2);
});
test('invalid geometry skipped and burst is bounded',()=>{
  assert.equal(planBattleEffects([{type:'card_destroyed',target:{cardRef:'a'}}],new Map([['a',{...r,width:0}]]),new Map()).length,0);
  assert.equal(planBattleEffects(Array.from({length:100},()=>({type:'card_destroyed',target:{cardRef:'a'}})),a,a).length,32);
});

test('overlay is bounded, inert, cleared on OFF, reduced motion, resize and disposal',()=>{
  const callbacks=new Map(), timers=new Map(), rootEvents=new Map();let id=0,cancelled=0;
  class Element {
    constructor(){this.children=[];this.style={};this.attrs={};}
    setAttribute(k,v){this.attrs[k]=v;}
    appendChild(el){this.children.push(el);el.parent=this;}
    remove(){this.parent.children=this.parent.children.filter(el=>el!==this);}
    animate(){return {cancel(){cancelled++;}};}
  }
  const media={matches:false,addEventListener(t,fn){this.fn=fn;},removeEventListener(){this.fn=null;}};
  const win={matchMedia:()=>media,setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);},addEventListener(t,fn){callbacks.set(t,fn);},removeEventListener(t){callbacks.delete(t);}};
  const body=new Element();
  const root={ownerDocument:{body,defaultView:win,createElementNS:()=>new Element()},querySelectorAll:()=>[],addEventListener(t,fn){rootEvents.set(t,fn);},removeEventListener(t){rootEvents.delete(t);}};
  const fx=createBattleFx(root), events=[{type:'card_destroyed',target:{cardRef:'a'}}];
  fx.play(events,a);[...timers.values()][0]();assert.equal(body.children.length,0);assert.equal(timers.size,0);
  fx.play(events,a); assert.equal(body.children[0].attrs['aria-hidden'],'true');
  assert.match(body.children[0].style.cssText,/pointer-events:none/);
  fx.play(Array(40).fill(events[0]),a);assert.equal(timers.size,32);
  fx.play([],a,false);assert.equal(body.children.length,0);assert.equal(timers.size,0);
  media.matches=true;fx.play(events,a);assert.equal(timers.size,0);
  media.matches=false;fx.play(events,a);callbacks.get('resize')();assert.equal(timers.size,0);
  fx.play(events,a);rootEvents.get('board-camera-change')();assert.equal(timers.size,0);
  fx.play(events,a);fx.dispose();fx.play(events,a);
  assert.equal(timers.size,0);assert.equal(body.children.length,0);assert.equal(callbacks.size,0);assert.equal(rootEvents.size,0);assert.ok(cancelled>0);
});

import { planMotion, motionTimeline, MOTION, bannerTurn } from '../src/ui-refresh/motion-fx.js';
import { planImpact, shakeFrames, cardKickFrames, IMPACT, CRITICAL_DAMAGE } from '../src/ui-refresh/impact-fx.js';
const anchors=(cards=[],zones=[])=>({cards:new Map(cards),zones:new Map(zones),lit:new Map()});
const handCard={left:100,top:600,width:60,height:84}, slot={left:300,top:200,width:90,height:70};
test('a played hand card flies from its hand position onto its slot',()=>{
  const plan=planMotion([{type:'card_moved',source:{cardRef:'h1'},target:{cardRef:'h1',definitionId:'STD-001',faceDown:false},
    from:{kind:'zone',seatId:'p1',zone:'hand'},to:{kind:'board',seatId:'p1',zone:'front',position:1}}],
    anchors([['h1',handCard]]),anchors([['h1',slot]]),'p1');
  assert.equal(plan.flights.length,1);
  assert.deepEqual(plan.flights[0].from,handCard);
  assert.deepEqual(plan.flights[0].to,slot);
  assert.equal(plan.flights[0].landsOnCard,true);
});
test('a draw leaves the deck and an install shrinks into the registry',()=>{
  const deck={left:900,top:500,width:80,height:100}, registry={left:0,top:100,width:120,height:300};
  const plan=planMotion([
    {type:'card_moved',source:null,target:{cardRef:'d1'},from:{kind:'unobserved'},to:{kind:'zone',seatId:'p1',zone:'hand'}},
    {type:'card_moved',source:{cardRef:'h2'},target:{cardRef:'r2'},from:{kind:'zone',seatId:'p1',zone:'hand'},to:{kind:'zone',seatId:'p1',zone:'registry'}}],
    anchors([['h2',handCard]],[['p1:deck',deck],['p1:registry',registry]]),anchors([['d1',handCard]],[['p1:registry',registry]]),'p1');
  assert.equal(plan.flights.length,2);
  const [draw,install]=plan.flights;
  assert.equal(draw.from.left+draw.from.width/2,940);
  assert.deepEqual(draw.to,handCard);
  assert.equal(install.landsOnCard,false);
  assert.equal(install.zone,'registry');
  assert.equal(install.to.left+install.to.width/2,60);
  assert.ok(install.to.width<handCard.width);
});
test('an opponent card appears from their hand; unseen destinations are skipped',()=>{
  const enemyHand={left:500,top:0,width:200,height:60};
  const plan=planMotion([
    {type:'card_moved',source:null,target:{cardRef:'e1',faceDown:true},from:{kind:'unobserved'},to:{kind:'board',seatId:'p2',zone:'back',position:2}},
    {type:'card_moved',source:{cardRef:'x'},target:null,from:{kind:'board',seatId:'p2',zone:'front',position:1},to:{kind:'unobserved'}}],
    anchors([['x',slot]],[['p2:hand',enemyHand]]),anchors([['e1',slot]]),'p1');
  assert.equal(plan.flights.length,1);
  assert.equal(plan.flights[0].faceDown,true);
  assert.equal(plan.flights[0].from.top+plan.flights[0].from.height/2,30);
});
test('beats run impact, banner, flight in order and fit the per-move budget',()=>{
  const plan={impact:true,turn:{seat:'p2',mine:false,turnNumber:3},flights:[{}]};
  const time=motionTimeline(plan);
  assert.ok(time.end<=MOTION.budget);
  assert.ok(time.impactAt<time.bannerAt&&time.bannerAt<time.flyAt);
  assert.deepEqual(motionTimeline({impact:false,turn:null,flights:[]}).end,0);
  assert.equal(motionTimeline({impact:false,turn:null,flights:[{}]}).flyFor,MOTION.fly);
});

test('turn banner counts the new turn from its own side, falling back to the match number',()=>{
  const turn={seat:'p2',mine:false,turnNumber:5};
  assert.deepEqual(bannerTurn(turn,3),{seat:'p2',mine:false,turnNumber:3});
  assert.equal(bannerTurn(turn,null).turnNumber,5);assert.equal(bannerTurn(turn,0).turnNumber,5);
  assert.equal(bannerTurn(null,3),null);
});

test('memory gauge: ten cells in the whole frame, lit for what is left, grey for what is spent, blank past the max',()=>{
  assert.equal(CELL_PATHS.length,CELLS);
  assert.deepEqual(memoryMeterModel({current:3,max:7}).cells.map(c=>c.state),
    ['lit','lit','lit','spent','spent','spent','spent','blank','blank','blank']);
  assert.equal(memoryMeterModel({current:0,max:0}).cells.every(c=>c.state==='blank'),true);
  assert.equal(memoryMeterModel({current:5,max:5}).extra,0);
  const html=memoryMeterHtml({current:2,max:4});
  assert.equal((html.match(/data-mem-state="lit"/g)??[]).length,2);
  assert.equal((html.match(/data-mem-state="spent"/g)??[]).length,2);
  assert.doesNotMatch(html,/wf-meter-extra/);
});
test('memory gauge adds +N above the frame only while more than ten are left',()=>{
  const meter=memoryMeterModel({current:12,max:13});
  assert.equal(meter.cells.every(c=>c.state==='lit'),true);
  assert.equal(meter.extra,2);
  assert.match(memoryMeterHtml({current:12,max:13}),/>\+2</);
  assert.equal(memoryMeterModel({current:10,max:13}).extra,0);
  assert.doesNotMatch(memoryMeterHtml({current:8,max:13}),/wf-meter-extra/);
  assert.equal(memoryMeterModel({current:8,max:13}).cells.filter(c=>c.state==='lit').length,8);
  assert.equal(memoryMeterModel({current:60,max:99}).extra,50);
});
test('only the cells just spent flash, and only within the same match and seat',()=>{
  const at=(current,max=7,key='m:p1')=>({key,current,max});
  assert.deepEqual(spentCells(at(5),at(2)),[2,3,4]);
  assert.deepEqual(spentCells(at(2),at(5)),[]);
  assert.deepEqual(spentCells(at(5),at(5)),[]);
  assert.deepEqual(spentCells(null,at(2)),[]);
  assert.deepEqual(spentCells(at(5,7,'m:p1'),at(2,7,'n:p1')),[]);
  assert.deepEqual(spentCells(at(13,13),at(8,13)),[8,9]);
  assert.deepEqual(spentCells(at(13,13),at(11,13)),[]);
});

const impactModel={match:{viewerSeat:'p1'},seats:[{seatId:'p1',user:{incidents:[15,11,7,3]}},{seatId:'p2',user:{incidents:[15,11,7,3]}}]};
const userHit=(seatId,before,after)=>({type:'user_damaged',target:{kind:'user',seatId},amount:before-after,before,after});
test('only the viewer taking damage shakes the screen; one hit of 5 or more is critical',()=>{
  assert.equal(CRITICAL_DAMAGE,5);
  assert.equal(planImpact([userHit('p1',20,18)],impactModel).screen,'hit');
  assert.equal(planImpact([userHit('p2',20,10)],impactModel).screen,'none');
  assert.equal(planImpact([userHit('p1',20,16)],impactModel).screen,'hit');
  assert.equal(planImpact([userHit('p1',20,15)],impactModel).screen,'critical');
  assert.equal(planImpact([userHit('p1',16,14),userHit('p1',14,12)],impactModel).screen,'hit');
  assert.equal(planImpact([userHit('p1',20,12),userHit('p1',12,11)],impactModel).screen,'critical');
});
test('damaged cards are kicked once each, with their hits added up',()=>{
  const hit=(cardRef,amount)=>({type:'card_damaged',target:{cardRef},amount});
  assert.deepEqual(planImpact([hit('a',2),hit('b',1),hit('a',3)],impactModel).cards,[{cardRef:'a',amount:5},{cardRef:'b',amount:1}]);
  assert.deepEqual(planImpact([hit('a',0)],impactModel).cards,[]);
});
test('shakes die out and come back to rest; a critical shake is stronger',()=>{
  const reach=frames=>Math.max(...frames.map(f=>Math.abs(Number(f.transform.match(/translate\(([-\d.]+)px/)[1]))));
  const hit=shakeFrames(IMPACT.hit),critical=shakeFrames(IMPACT.critical);
  assert.equal(hit.at(-1).transform,'translate(0px,0px)');
  assert.ok(reach(critical)>reach(hit));
  assert.deepEqual(shakeFrames(IMPACT.hit,3),shakeFrames(IMPACT.hit,3));
});
test('a kicked card lifts, sways toward its side and settles back',()=>{
  const frames=cardKickFrames(3,1);
  assert.equal(frames[0].offset,0);assert.equal(frames.at(-1).offset,1);
  assert.equal(frames.at(-1).transform,'translate(0px,0px) rotate(0deg) scale(1)');
  const xs=frames.map(f=>Number(f.transform.match(/translate\(([-\d.]+)px/)[1]));
  const ys=frames.map(f=>Number(f.transform.match(/,([-\d.]+)px\)/)[1]));
  assert.ok(Math.max(...xs)>4);assert.ok(Math.min(...ys)<-4);
  assert.ok(Math.min(...cardKickFrames(3,-1).map(f=>Number(f.transform.match(/translate\(([-\d.]+)px/)[1])))<-4);
  assert.ok(Math.max(...cardKickFrames(6,1).map(f=>Number(f.transform.match(/translate\(([-\d.]+)px/)[1])))>Math.max(...xs));
});

import { boardPieces } from '../src/ui-refresh/wireframe/board-view.js';
import { boardToWorld, screenToWorld, readMotion } from '../src/ui-refresh/wireframe/card-meshes.js';
import { project } from '../src/ui-refresh/wireframe/geometry.js';
const pieceCard=(cardRef,position,extra={})=>({cardRef,faceDown:false,slot:position,location:{position},status:{sleep:false},definition:{id:'STD-001',name:'x',category:'Ob',atk:1},computed:{currentAtk:1,currentStr:1},interaction:{},...extra});
const pieceSeat=(seatId,front,back=[])=>({seatId,user:{name:seatId,frontLimit:3,backLimit:3},front:{cards:front},back:{cards:back},registry:{cards:[{faceDown:false}],count:1},deck:{count:20},trash:{count:0}});
test('3D board lays a slab under every card and pile the SVG draws', () => {
  const model={match:{viewerSeat:'p1'},seats:[pieceSeat('p1',[pieceCard('a',1),pieceCard('s',2,{status:{sleep:true}})],[pieceCard('c',1,{definition:{id:'STD-036',name:'c',category:'Code',atk:null}})]),pieceSeat('p2',[{cardRef:'d',faceDown:true,slot:1,location:{}}])]};
  const pieces=boardPieces(model), by=key=>pieces.find(p=>p.key===key);
  assert.equal(pieces.filter(p=>p.kind==='card').length,4);
  assert.deepEqual([by('card:a').horizontal,by('card:a').turned],[false,false]);
  assert.deepEqual([by('card:s').horizontal,by('card:s').turned],[true,true]);
  assert.deepEqual([by('card:c').horizontal,by('card:c').turned],[true,false]);
  assert.equal(by('card:d').faceDown,true);assert.equal(by('card:d').art,null);
  assert.ok(by('card:a').art);
  assert.equal(by('card:a').node,'.board-slot[data-card-ref="a"]');
  assert.equal(by('deck:p1').count,20);assert.equal(by('trash:p1'),undefined);
  assert.equal(pieces.filter(p=>p.kind==='registry').length,2);
  model.seats[0].registry.cards=[pieceCard('r1',0),pieceCard('r2',0,{definition:{id:'STD-036',category:'Plugin'}}),{cardRef:'r3',faceDown:true}];
  const reg=boardPieces(model).filter(p=>p.key.startsWith('registry:p1'));
  assert.deepEqual(reg.map(p=>[Boolean(p.art),p.horizontal,p.turned,p.faceDown]),[[true,true,true,false],[true,true,false,false],[false,true,false,true]]);
});
test('slabs sit where the SVG projection puts the card, and follow its screen motion', () => {
  // World point seen by the board camera at (0,d,d) looking at the origin.
  const screen=(x,y,z)=>{const w=boardToWorld(x,y,z),q=Math.SQRT1_2,depth=Math.SQRT2*12.4-(w.z+w.y)*q,f=450/Math.tan(38*Math.PI/360);
    return {x:800+w.x*f/depth,y:450+(w.z-w.y)*q*f/depth};};
  for(const [x,y,z] of [[525,450,0],[360,816,4],[1070,50,40]]){const a=screen(x,y,z),b=project(x,y,z);assert.ok(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9);}
  const piece={x:525,y:580,count:1};
  const up=screenToWorld(piece,10,-20);
  assert.ok(up.x>0&&up.lift>0&&up.z===0);
  const down=screenToWorld(piece,0,15);assert.ok(down.z>0&&down.lift===0);
  const m=readMotion({visibility:'visible',opacity:'.5',transform:'matrix(0.866025, 0.5, -0.5, 0.866025, 12, -8)'});
  assert.equal(m.dx,12);assert.equal(m.dy,-8);assert.ok(Math.abs(m.angle-Math.PI/6)<1e-6);assert.equal(m.opacity,.5);
  assert.equal(readMotion({visibility:'hidden',transform:'none'}).hidden,true);
});
