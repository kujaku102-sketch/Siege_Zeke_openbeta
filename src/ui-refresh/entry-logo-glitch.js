import { mountLogoNoise } from './logo-noise-renderer.js';

export function createEntryLogoController({ mount = mountLogoNoise, motion } = {}) {
  let current=null, canvas=null, lastRoot=null, lastEnabled=false, lastOptions={};
  let failedCanvas=null;
  function stop(){current?.dispose();current=null;canvas=null;}
  function sync(root, enabled, options={}){
    const fileChanged=lastOptions.videoFile!==options.videoFile || lastOptions.capture!==options.capture;
    lastRoot=root;lastEnabled=enabled;lastOptions=options;
    const next=root.querySelector('.r2-logo-canvas');
    if(!next||!enabled||motion?.matches){stop();failedCanvas=null;if(next)next.dataset.noise='static';return;}
    if(next!==canvas||fileChanged){stop();failedCanvas=null;}
    if(current?.disposed){failedCanvas=next;stop();canvas=next;}
    if(current){current.setProfile(options.profile??'random');current.refresh();return;}
    if(failedCanvas===next){next.dataset.noise='static';return;}
    canvas=next;
    try{current=mount(next,{logoUrl:root.querySelector('.r2-intro img').src,...options});}
    catch{current=null;}
    if(!current){failedCanvas=next;next.dataset.noise='static';}
  }
  const resync=()=>{if(lastRoot)sync(lastRoot,lastEnabled,lastOptions);};
  motion?.addEventListener('change',resync);
  return {sync,suspend:stop,resume:resync,dispose(){stop();motion?.removeEventListener('change',resync);lastRoot=null;}};
}

let controller=null;
export function syncEntryLogoGlitch(root,enabled,options={}){
  if(!controller){
    controller=createEntryLogoController({motion:window.matchMedia('(prefers-reduced-motion: reduce)')});
    window.addEventListener('pagehide',()=>controller.suspend());
    window.addEventListener('pageshow',()=>controller.resume());
  }
  controller.sync(root,enabled,options);
}
