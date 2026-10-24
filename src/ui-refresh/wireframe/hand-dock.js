// Local presentation only; raising the hand never selects or executes a card.
export function attachHandDock(root, { busy = () => false, changed = () => {} } = {}) {
  const win=root.ownerDocument.defaultView, listeners=[];
  let open=false, timer=null, openingPointer=null, disposed=false, pendingLower=false;
  const inHand=node=>Boolean(node?.closest?.('.r2-hand'));
  const cancel=()=>{win.clearTimeout(timer);timer=null;};
  const sync=()=>{
    root.querySelector('.r2-runtime-view')?.classList.toggle('wf-hand-raised',open);
    root.querySelector('[data-live-region="hand"]')?.removeAttribute('hidden');
    if(pendingLower && !busy()){pendingLower=false;set(false);}
  };
  const set=value=>{if(disposed)return;cancel();if(value)pendingLower=false;if(open!==value){open=value;sync();changed();}};
  const lower=()=>{if(busy()){pendingLower=true;return;}if(inHand(root.ownerDocument.activeElement) && root.ownerDocument.activeElement.matches?.(':focus-visible'))return;set(false);};
  const later=delay=>{cancel();timer=win.setTimeout(()=>{timer=null;lower();},delay);};
  const listen=(type,fn)=>{root.addEventListener(type,fn,true);listeners.push([type,fn]);};
  listen('pointerover',e=>{
    if(e.pointerType==='mouse' && inHand(e.target)){set(true);}
  });
  listen('pointerout',e=>{
    if(e.pointerType==='mouse' && inHand(e.target) && !inHand(e.relatedTarget))later(350);
  });
  listen('pointerdown',e=>{
    if(e.button!==0)return;
    openingPointer=null;
    if(inHand(e.target)){
      if(!open){openingPointer=e.pointerId;set(true);e.preventDefault();e.stopImmediatePropagation();}
      else cancel();
    }else if(!e.target.closest?.('.r2-popup,.r2-detail,.effect-modal'))lower();
  });
  listen('click',e=>{
    if(openingPointer!==null && (e.pointerId===undefined || e.pointerId===openingPointer)){
      openingPointer=null;e.preventDefault();e.stopImmediatePropagation();later(2500);
    }
  });
  listen('pointerup',e=>{if(e.pointerType!=='mouse' && inHand(e.target))later(2500);});
  listen('pointercancel',()=>{openingPointer=null;});
  listen('focusin',e=>{if(inHand(e.target) && e.target.matches?.(':focus-visible'))set(true);});
  listen('focusout',e=>{if(inHand(e.target) && !inHand(e.relatedTarget))later(350);});
  return {sync,lower,dispose(){disposed=true;cancel();for(const [type,fn] of listeners)root.removeEventListener(type,fn,true);}};
}
