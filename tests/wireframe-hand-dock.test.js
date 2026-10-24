import test from 'node:test';
import assert from 'node:assert/strict';
import {attachHandDock} from '../src/ui-refresh/wireframe/hand-dock.js';

function fixture(){
  let raised=false, busy=false,id=0;const listeners=new Map(),timers=new Map();
  const root={ownerDocument:{defaultView:{setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(i){timers.delete(i);}}},
    querySelector(s){return s==='.r2-runtime-view'?{classList:{toggle(n,v){raised=v;}}}:{removeAttribute(){}};},
    addEventListener(t,fn){listeners.set(t,fn);},removeEventListener(t){listeners.delete(t);}};
  const hand={closest:s=>s==='.r2-hand'?hand:null,matches:()=>false},outside={closest:()=>null};
  const dock=attachHandDock(root,{busy:()=>busy});
  return {dock,hand,outside,listeners,timers,get raised(){return raised;},set busy(v){busy=v;},
    emit(type,props={}){const e={target:hand,button:0,pointerId:7,pointerType:'touch',preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...props};listeners.get(type)(e);return e;},
    flush(){const tasks=[...timers.values()];timers.clear();for(const fn of tasks)fn();}};
}
test('first collapsed tap raises only, second tap reaches normal card interaction',()=>{
  const f=fixture();f.dock.sync();assert.equal(f.raised,false);
  assert.equal(f.emit('pointerdown').stopped,true);assert.equal(f.raised,true);
  assert.equal(f.emit('click').stopped,true);
  assert.equal(f.emit('pointerdown').stopped,undefined);
  assert.equal(f.emit('click').stopped,undefined);
  f.emit('pointerup');f.flush();assert.equal(f.raised,false);
});
test('mouse hover raises, leaving lowers without touching game state',()=>{
  const f=fixture();f.emit('pointerover',{pointerType:'mouse'});assert.equal(f.raised,true);
  f.emit('pointerout',{pointerType:'mouse',relatedTarget:f.outside});f.flush();assert.equal(f.raised,false);
});
test('pending choice postpones lowering until sync after completion; outside press and disposal work',()=>{
  const f=fixture();f.emit('pointerover',{pointerType:'mouse'});f.busy=true;
  f.emit('pointerdown',{target:f.outside});assert.equal(f.raised,true);
  f.busy=false;f.dock.sync();assert.equal(f.raised,false);
  f.emit('pointerover',{pointerType:'mouse'});f.emit('pointerup');
  f.dock.dispose();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});
