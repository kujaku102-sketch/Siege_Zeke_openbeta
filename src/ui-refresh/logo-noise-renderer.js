import { logoVertexShader, logoFragmentShader } from './logo-noise-shader.js';
import { LOGO_FIT, LOGO_EFFECT_SPEED, logoEffectDelta, createLogoAreas, createLogoBands, updateLogoAreas, updateLogoBands } from './logo-noise-model.js';

// Owns only presentation resources. Nothing in this module touches game state.
export function mountLogoNoise(canvas, { logoUrl, profile = 'random', videoFile = null, capture = false } = {}) {
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:Boolean(capture)});
  if(!gl) return null;
  // Keep presentation randomness separate from the engine's shuffle RNG.
  const seedWords=new Uint32Array(1);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(seedWords);
  let visualSeed=seedWords[0]||Math.floor(performance.now()*1000)||1;
  const visualRandom=()=>((visualSeed=(Math.imul(visualSeed,1664525)+1013904223)>>>0)/0x100000000);
  let disposed=false,frameId=0,lastFrame=0,clock=.1,nextPattern=1,logoReady=false,frameTick=()=>{};
  let rect=canvas.getBoundingClientRect(),bands=createLogoBands(visualRandom);
  const areas=createLogoAreas(visualRandom),shaders=[],textures=[];
  let program=null,buffer=null,observer=null,video=null,videoUrl=null,videoReady=false;
  const logo=new Image();
  function stopFrame(){cancelAnimationFrame(frameId);frameId=0;lastFrame=0;video?.pause();}
  function dispose(){
    if(disposed)return;
    disposed=true;stopFrame();observer?.disconnect();
    document.removeEventListener('visibilitychange',visibility);
    canvas.removeEventListener('webglcontextlost',lost);
    logo.onload=null;logo.onerror=null;
    if(video){video.onloadeddata=null;video.onerror=null;video.pause();video.removeAttribute('src');video.load();}
    if(videoUrl)URL.revokeObjectURL(videoUrl);
    textures.forEach(texture=>gl.deleteTexture(texture));shaders.forEach(shader=>gl.deleteShader(shader));
    if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);
    canvas.dataset.noise='static';
  }
  function lost(event){event.preventDefault();dispose();}
  function visibility(){
    if(disposed)return;
    if(document.hidden){stopFrame();return;}
    if(videoReady)video.play().catch(()=>{videoReady=false;});
    if(!frameId)frameId=requestAnimationFrame(frame);
  }
  function shader(type,source){
    const item=gl.createShader(type);shaders.push(item);gl.shaderSource(item,source);gl.compileShader(item);
    if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(item));
    return item;
  }
  try {
    program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,logoVertexShader));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,logoFragmentShader));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    const names=['logo','video','bands[0]','styles[0]','time','aspect','videoReady','alpha','background','full','guides','cssSize','wear','warp','areas[0]','areaState[0]','profileState[0]','videoAspect','fit'];
    const uniforms=Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(program,`u_${n}`)]));
    gl.uniform4fv(uniforms['areas[0]'],new Float32Array(areas.flatMap(area=>area.box)));
    gl.uniform2f(uniforms.fit,...LOGO_FIT);gl.uniform1i(uniforms.logo,0);gl.uniform1i(uniforms.video,1);
    function texture(unit){
      const item=gl.createTexture();textures.push(item);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,item);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));return item;
    }
    const logoTexture=texture(0),videoTexture=texture(1);
    logo.onload=()=>{
      if(disposed)return;
      try{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,logoTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,logo);logoReady=true;
      }catch{dispose();}
    };
    logo.onerror=dispose;logo.src=logoUrl;
    if(videoFile){
      video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;video.playbackRate=LOGO_EFFECT_SPEED;
      video.onloadeddata=()=>{if(disposed)return;videoReady=true;if(!document.hidden)video.play().catch(()=>{videoReady=false;});};
      video.onerror=()=>{videoReady=false;};videoUrl=URL.createObjectURL(videoFile);video.src=videoUrl;video.load();
    }
    function draw(){
      if(!logoReady||rect.width<1||rect.height<1)return;
      const dpr=Math.min(window.devicePixelRatio||1,1.5),width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      gl.viewport(0,0,width,height);
      const {positions,styles}=updateLogoBands(bands,clock,nextPattern,rect.width,rect.height);
      const {state,profiles}=updateLogoAreas(areas,clock,profile,visualRandom);
      let ready=videoReady&&video.readyState>=2;
      if(ready){try{gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,videoTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
      }catch{ready=false;videoReady=false;video.pause();}}
      gl.uniform4fv(uniforms['bands[0]'],positions);gl.uniform4fv(uniforms['styles[0]'],styles);
      gl.uniform4fv(uniforms['areaState[0]'],state);gl.uniform4fv(uniforms['profileState[0]'],profiles);
      gl.uniform1f(uniforms.videoAspect,ready?video.videoWidth/video.videoHeight:16/9);
      gl.uniform1f(uniforms.time,clock);gl.uniform1f(uniforms.aspect,rect.width/rect.height);gl.uniform1f(uniforms.videoReady,ready?1:0);
      gl.uniform1f(uniforms.alpha,.7);gl.uniform1f(uniforms.background,0);gl.uniform1f(uniforms.full,1);gl.uniform1f(uniforms.guides,0);
      gl.uniform2f(uniforms.cssSize,rect.width,rect.height);gl.uniform4f(uniforms.wear,1,.45,1,.85);gl.uniform1f(uniforms.warp,1.2);
      gl.drawArrays(gl.TRIANGLES,0,6);canvas.dataset.noise='playing';
    }
    // Stop scheduling entirely while hidden; cap visible rendering at 30fps.
    function tick(now){
      if(disposed||document.hidden)return;
      if(now-lastFrame>=1000/30){clock+=lastFrame?logoEffectDelta((now-lastFrame)/1000):0;lastFrame=now;
        if(clock>=nextPattern){bands=createLogoBands(visualRandom);nextPattern=clock+1;}draw();}
    }
    frameTick=tick;
    observer=new ResizeObserver(()=>{rect=canvas.getBoundingClientRect();});observer.observe(canvas);
    canvas.addEventListener('webglcontextlost',lost);
    document.addEventListener('visibilitychange',visibility);visibility();
    return { dispose, get disposed(){return disposed;}, setProfile(value){profile=value;}, refresh(){rect=canvas.getBoundingClientRect();} };
  }catch(error){dispose();console.warn('Logo effect unavailable; using static SVG.',error);return null;}
  // Assigned before scheduling the first frame; shared with visibility callbacks.
  function frame(now){frameId=0;if(disposed||document.hidden)return;try{frameTick(now);frameId=requestAnimationFrame(frame);}catch{dispose();}}
}
