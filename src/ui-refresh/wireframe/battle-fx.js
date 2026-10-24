// Presentation only: public events + visible board geometry. Never delays a command.
const NS = 'http://www.w3.org/2000/svg';
const valid = r => r && [r.left,r.top,r.width,r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
const center = r => [r.left+r.width/2,r.top+r.height/2];

export function captureBattleAnchors(root) {
  const anchors = new Map();
  for (const node of root.querySelectorAll('.wire-board .board-slot[data-card-ref],.wire-board [data-fortress],.wf-status[data-user-seat]')) {
    const key = node.dataset.cardRef ?? (node.dataset.userSeat ? `hud:${node.dataset.userSeat}` : `user:${node.dataset.fortress}`);
    const r = node.getBoundingClientRect();
    if (valid(r)) anchors.set(key,{left:r.left,top:r.top,width:r.width,height:r.height});
  }
  return anchors;
}

export function planBattleEffects(events, before, after) {
  const cues = [];
  const rect = (key, old = false) => {
    const r = old ? before.get(key) ?? after.get(key) : after.get(key) ?? before.get(key);
    return valid(r) ? r : null;
  };
  for (const e of events) {
    const target = e.target?.cardRef ?? `user:${e.target?.seatId}`;
    if (e.type === 'attack_declared') {
      const from = rect(e.source?.cardRef,true), to = rect(target,true);
      if (from && to) cues.push({kind:'attack',from,to});
    } else if (e.type === 'card_destroyed') {
      const at = rect(target,true);
      if (at) cues.push({kind:'destroy',at});
    } else if (e.type === 'card_moved' && e.to?.kind === 'board' && e.from?.kind !== 'board') {
      const at = rect(target);
      if (at) cues.push({kind:'deploy',at});
    } else if (e.type === 'card_damaged' || e.type === 'user_damaged') {
      // combat_resolved is a summary; card_damaged contains each actual hit,
      // including retaliation. Do not display the same damage twice.
      const at = rect(e.type === 'user_damaged' ? `hud:${e.target?.seatId}` : target,true);
      if (at && Number.isFinite(e.amount) && e.amount > 0) cues.push({kind:'damage',at,amount:e.amount});
    }
  }
  return cues.slice(-32);
}

export function createBattleFx(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const reduced = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let layer = null, disposed = false;
  const active = new Map();
  const node = (tag, attrs = {}, parent = layer) => {
    const el = doc.createElementNS(NS,tag);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
    parent.appendChild(el); return el;
  };
  const remove = group => {
    const entry = active.get(group);
    if (!entry) return;
    win.clearTimeout(entry.timer);
    for (const animation of entry.animations) animation.cancel();
    group.remove(); active.delete(group);
    if (!active.size) { layer?.remove(); layer=null; }
  };
  const clear = () => { for (const group of [...active.keys()]) remove(group); };
  const animate = (el, frames, duration, entry) => {
    if (el.animate) entry.animations.push(el.animate(frames,{duration,easing:'ease-out',fill:'forwards'}));
  };
  const play = (events,before,enabled = true) => {
    if (disposed || !enabled || reduced?.matches) { clear(); return; }
    const cues = planBattleEffects(events,before,captureBattleAnchors(root));
    for (const cue of cues) {
      if (active.size >= 32) remove(active.keys().next().value);
      if (!layer) {
        layer=doc.createElementNS(NS,'svg');
        layer.setAttribute('aria-hidden','true'); layer.setAttribute('class','wf-battle-fx');
        layer.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:45;overflow:hidden';
        doc.body.appendChild(layer);
      }
      const group=node('g',{'data-fx':cue.kind});
      const entry={animations:[],timer:null}; active.set(group,entry);
      const duration=cue.kind==='attack'?300:cue.kind==='deploy'?360:620;
      // Schedule cleanup before drawing so a decorative API failure cannot leak it.
      entry.timer=win.setTimeout(()=>remove(group),duration);
      animate(group,[{opacity:1},{opacity:0}],duration,entry);
      if (cue.kind==='attack') {
        const [x,y]=center(cue.from),[tx,ty]=center(cue.to);
        const path=node('path',{d:`M${x} ${y} L${tx} ${ty}`,fill:'none',stroke:'#b8ffff','stroke-width':3,pathLength:1,'stroke-dasharray':'0.22 0.78'},group);
        animate(path,[{strokeDashoffset:1},{strokeDashoffset:0}],duration,entry);
      } else {
        const [x,y]=center(cue.at),size=Math.max(12,Math.min(cue.at.width,cue.at.height)*.45);
        const color=cue.kind==='deploy'?'#81fff0':cue.kind==='damage'?'#ffcf70':'#a1eaff';
        const ring=node('path',{d:`M${x} ${y-size} L${x+size} ${y} L${x} ${y+size} L${x-size} ${y} Z`,fill:'none',stroke:color,'stroke-width':2},group);
        ring.style.transformOrigin=`${x}px ${y}px`;
        animate(ring,[{transform:'scale(.6)'},{transform:'scale(1.35)'}],duration,entry);
        if(cue.kind==='destroy') for(let i=0;i<8;i++) {
          const angle=i*Math.PI/4,dx=Math.cos(angle)*size*1.5,dy=Math.sin(angle)*size*1.5;
          const shard=node('path',{d:`M${x-4} ${y-5} l12 3 l-8 10 Z`,fill:color},group);
          shard.style.transformOrigin=`${x}px ${y}px`;
          animate(shard,[{transform:'translate(0px,0px) rotate(0deg)'},{transform:`translate(${dx}px,${dy}px) rotate(${i%2?95:-95}deg)`}],duration,entry);
        }
        if(cue.kind==='damage') {
          const text=node('text',{x,y,'text-anchor':'middle','dominant-baseline':'central',fill:'#fff4d6',stroke:'#180f08','stroke-width':3,'paint-order':'stroke','font-family':'Georgia,serif','font-size':Math.max(20,Math.min(40,cue.at.height*.4)),'font-weight':'bold'},group);
          text.textContent=`−${cue.amount}`;
          animate(text,[{transform:'translateY(0px)'},{transform:'translateY(-24px)'}],duration,entry);
        }
      }
    }
  };
  win?.addEventListener('resize',clear);
  root.addEventListener('board-camera-change',clear);
  reduced?.addEventListener?.('change',clear);
  return {play,clear,dispose(){disposed=true;clear();win?.removeEventListener('resize',clear);root.removeEventListener('board-camera-change',clear);reduced?.removeEventListener?.('change',clear);}};
}
