import { DEFAULT_RENDER_QUALITY, DISPLAY_FONT, renderResolution, observeDrawing } from './render-resolution.js';
// Local presentation animation, never a second game state. A new receipt
// retargets from the current displayed position; authoritative STR stays in DOM.
export function attachLifeView(root, quality = DEFAULT_RENDER_QUALITY) {
  const tracks=new Map();let raf=0,animate=false;
  const reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function draw(track,now){
    const {canvas}=track,rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const {width:w,height:h}=renderResolution(rect.width,rect.height,quality,globalThis.devicePixelRatio);
    if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    const c=canvas.getContext('2d');c.clearRect(0,0,w,h);
    const t=animate?Math.min(1,(now-track.started)/450):1;
    track.display=track.from+(track.target-track.from)*(1-(1-t)**3);
    const direction=track.mine?1:-1,anchor=track.mine?w-h*.7:h*.7;
    c.textAlign='center';c.textBaseline='bottom';
    for(let n=Math.floor(track.display)-4;n<=Math.ceil(track.display)+4;n++){
      if(n<Math.min(0,track.from,track.target)||n>Math.max(track.maximum,track.from,track.target))continue;
      const offset=n-track.display,x=anchor+direction*offset*h*.51;
      const weight=Math.max(0,1-Math.abs(offset));
      c.font=`${h*(.48+.58*weight)}px ${DISPLAY_FONT}`;
      c.fillStyle=weight>.5?'#fff':'#967e7e';c.strokeStyle=weight>.5?'#111':'#777';c.lineWidth=Math.max(1,h*.009);
      c.strokeText(String(n),x,h);c.fillText(String(n),x,h);
      if(track.thresholds.includes(n)){
        c.font=`${h*.23}px sans-serif`;c.fillStyle=track.used.includes(n)?'#736a43':'#f1df3d';
        c.fillText('⚠',x,h*.99);
      }
    }
    if(t<1)request();
  }
  function frame(now){raf=0;for(const track of tracks.values())draw(track,now);}
  function request(){if(!raf)raf=requestAnimationFrame(frame);}
  const observer=observeDrawing(root,request);
  return {sync(model,effects){
    animate=effects&&!reduced();const now=performance.now();
    for(const seat of model.seats){
      const canvas=[...root.querySelectorAll('[data-life-seat]')].find(c=>c.dataset.lifeSeat===seat.seatId);
      if(!canvas)continue;
      let track=tracks.get(seat.seatId);
      if(!track){track={display:seat.fortressStr,from:seat.fortressStr,target:seat.fortressStr,started:now};tracks.set(seat.seatId,track);}
      if(track.target!==seat.fortressStr){track.from=track.display;track.target=seat.fortressStr;track.started=now;}
      Object.assign(track,{canvas,mine:seat.seatId===model.match.viewerSeat,maximum:seat.user.maxFortressStr,thresholds:seat.user.incidents,used:seat.incidents});
    }
    request();
  },dispose(){observer.dispose();cancelAnimationFrame(raf);tracks.clear();}};
}
