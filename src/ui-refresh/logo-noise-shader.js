// Shared by the entry screen and the visual prototype.
export const logoVertexShader = `attribute vec2 a_position; varying vec2 v_uv; void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
export const logoFragmentShader = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_logo, u_video;
uniform vec4 u_bands[23], u_styles[23];
uniform vec2 u_cssSize, u_fit;
uniform vec4 u_wear;
uniform vec4 u_areas[12], u_areaState[12], u_profileState[12];
uniform float u_videoAspect;
uniform float u_warp;
uniform float u_time, u_aspect, u_videoReady, u_alpha, u_background, u_full, u_guides;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 sampleNoise(vec2 p){
  if(u_videoReady>.5) return texture2D(u_video,fract(p)).rgb;
  float tick=floor(u_time*24.);
  float stripe=step(.73,hash(vec2(floor(p.y*95.),tick)));
  float grain=hash(floor(p*vec2(640.,360.))+tick);
  float patch=step(.78,hash(floor(p*vec2(14.,18.))+floor(tick*.3)));
  return vec3(clamp(grain*.25+stripe*.68+patch*.5,0.,1.));
}
vec3 composite(vec3 base,vec3 source,float mode){
  if(mode<.5)return source;
  if(mode<1.5)return base*source;
  if(mode<2.5)return 1.-(1.-base)*(1.-source);
  if(mode<3.5)return min(vec3(1.),base/max(vec3(.001),1.-source));
  if(mode<4.5)return min(vec3(1.),base+source);
  return abs(base-source);
}
float boxEdge(vec2 p,vec2 lo,vec2 hi){
  vec2 d=min(p-lo,hi-p);
  return step(0.,min(d.x,d.y))*(1.-step(.003,min(d.x,d.y)));
}
float inRect(vec2 q){return step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);}
float field(vec2 p){
  vec2 cell=floor(p), t=fract(p); t=t*t*(3.-2.*t);
  return mix(mix(hash(cell),hash(cell+vec2(1.,0.)),t.x),mix(hash(cell+vec2(0.,1.)),hash(cell+1.),t.x),t.y);
}
float logoAlpha(vec2 p){return texture2D(u_logo,clamp(p,0.,1.)).a*inRect(p);}
float fleck(vec2 pixels,float size,float salt,float density){
  vec2 grid=pixels/max(size*1.5,1.), cell=floor(grid)+salt;
  float seed=hash(cell);
  vec2 center=vec2(.5)+vec2(hash(cell+9.),hash(cell+23.)-.5)*vec2(.24,.3)-vec2(.12,0.);
  vec2 local=(fract(grid)-center)*vec2(.75+hash(cell+3.)*.7,.85+hash(cell+8.)*.6);
  // The seed and center remain fixed; only the extent of each fragment slowly breathes.
  float pulse=.92+.08*sin(u_time*2.1+seed*19.);
  float radius=(.3+hash(cell+7.)*.06)*pulse;
  float roughness=(field(grid*5.+salt)-.5)*.16;
  float shape=1.-smoothstep(radius-.045,radius+.045,length(local)+roughness);
  float cluster=.4+.6*field(pixels/(size*7.)+salt);
  return shape*step(1.-density*cluster,seed);
}
void main(){
  float bg=u_background<.5?1.:(u_background<1.5?.43:.045);
  vec3 color=vec3(bg);
  vec2 logoSize=vec2(u_fit.x,u_fit.x*u_aspect/(495./285.));
  if(logoSize.y>u_fit.y){logoSize*=u_fit.y/logoSize.y;}
  vec2 logoUv=(v_uv-.5)/logoSize+.5;
  float regionalStrength=0.;
  vec3 regionalSettings=vec3(1.);
  vec4 regionalProfile=vec4(0.), regionalBox=vec4(0.);
  for(int region=0;region<12;region++){
    vec4 area=u_areas[region];
    vec2 edge=area.zw*.5-abs(logoUv-area.xy);
    vec2 feather=smoothstep(vec2(0.),vec2(5./495.,5./285.),edge);
    float weight=feather.x*feather.y*u_areaState[region].x;
    if(weight>regionalStrength){regionalStrength=weight;regionalSettings=u_areaState[region].yzw;regionalProfile=u_profileState[region];regionalBox=area;}
  }
  float wearStrength=u_full*regionalStrength;
  if(all(greaterThanEqual(logoUv,vec2(0.)))&&all(lessThanEqual(logoUv,vec2(1.)))){
    vec2 logoPixels=u_cssSize*logoSize, pixels=logoUv*logoPixels;
    vec2 displaced=logoUv;
    if(wearStrength>0.&&regionalProfile.x<.5){
      vec2 warp=vec2(field(pixels/10.+vec2(u_time*.12,0.)),field(pixels/11.+vec2(19.,u_time*.1)))-.5;
      displaced+=warp*2.*u_warp*wearStrength*regionalSettings.z/logoPixels;
    }
    vec4 logo=texture2D(u_logo,clamp(displaced,0.,1.));
    float originalAlpha=logoAlpha(logoUv);
    float alpha=logo.a*inRect(displaced);
    if(wearStrength>0.&&regionalProfile.x<.5){
      float size=regionalSettings.y;
      float density=min(1.,u_wear.y*regionalSettings.x);
      float holes=max(fleck(pixels,size,11.,density),fleck(pixels,mix(6.,size,.5),83.,density*.55));
      alpha*=1.-holes*u_wear.z*wearStrength;
      // Fragments are limited to a narrow neighborhood of the original silhouette.
      vec2 reach=vec2(3.+size*1.7)/logoPixels;
      float nearInk=max(max(logoAlpha(logoUv+vec2(reach.x,0.)),logoAlpha(logoUv-vec2(reach.x,0.))),max(logoAlpha(logoUv+vec2(0.,reach.y)),logoAlpha(logoUv-vec2(0.,reach.y))));
      nearInk=max(nearInk,max(max(logoAlpha(logoUv+reach*.7),logoAlpha(logoUv-reach*.7)),max(logoAlpha(logoUv+vec2(reach.x,-reach.y)*.7),logoAlpha(logoUv+vec2(-reach.x,reach.y)*.7))));
      float debris=fleck(pixels,max(6.,size*.8),157.,density*1.3)*nearInk*(1.-originalAlpha)*u_wear.w*wearStrength;
      alpha=max(alpha,debris);
    }
    vec3 ink=u_background>1.5?vec3(.93):vec3(.067,.094,.125);
    color=mix(color,ink,alpha);
    if(wearStrength>0.&&regionalProfile.x>.5){
      vec2 areaPixels=regionalBox.zw*logoPixels;
      vec2 relative=(logoUv-regionalBox.xy)*logoPixels;
      // Three truly square, overlapping video clips; one shared decoded video texture.
      for(int tile=0;tile<3;tile++){
        float seed=regionalProfile.y+float(tile)*23.;
        float side=min(areaPixels.x,areaPixels.y)*mix(.65,.9,hash(vec2(seed,7.)));
        vec2 center=(vec2(hash(vec2(seed,2.)),hash(vec2(seed,5.)))-.5)*(areaPixels-vec2(side))*.85;
        center+=vec2(sin(u_time*5.+seed),cos(u_time*4.+seed))*.7;
        vec2 q=(relative-center)/side+.5;
        if(inRect(q)>.5){
          float block=regionalSettings.y;
          vec2 pixelated=(floor(q*side/block)+.5)*block/side;
          vec2 clipOrigin=vec2(hash(vec2(seed,13.)),hash(vec2(seed,19.)))*.5;
          vec2 sampleUv=clipOrigin+pixelated*vec2(.4/max(u_videoAspect,1.),.4);
          vec3 source=sampleNoise(sampleUv);
          vec3 compositeTile=tile==0?source:composite(color,source,tile==1?5.:1.);
          float opacity=min(1.,wearStrength*1.5)*(tile==0?1.:.7);
          color=mix(color,compositeTile,opacity);
        }
      }
    }
  }
  for(int i=0;i<23;i++){
    vec4 band=u_bands[i]; vec4 style=u_styles[i];
    vec2 local=logoUv-band.xy;
    local.x-=local.y*style.z;
    vec2 q=local/max(band.zw,vec2(.0001))+.5;
    float inside=inRect(q);
    // The four vertical dakuten marks have independently offset chromatic copies.
    if(i>=19&&style.y>0.){
      float drift=.7+1.1*(.5+.5*sin(u_time*8.+float(i)));
      vec2 offset=vec2(drift,.35*sin(u_time*11.+float(i)))/(u_cssSize*logoSize);
      vec2 cyanQ=(local-offset)/band.zw+.5;
      vec2 pinkQ=(local+offset)/band.zw+.5;
      float cyanMask=inRect(cyanQ), pinkMask=inRect(pinkQ);
      if(cyanMask>0.||pinkMask>0.){
        float grain=1.-sampleNoise(vec2(q.x*.7+style.w,q.y*.13+fract(style.w*3.7))).r;
        float alpha=(.35+.65*grain)*style.y*u_alpha*.85;
        color=mix(color,vec3(0.,.7,.86),cyanMask*alpha);
        color=mix(color,vec3(.93,.12,.55),pinkMask*alpha);
      }
    }
    if(inside>.5&&style.y>0.){
      vec2 videoUv=vec2(q.x*.7+style.w,q.y*.13+fract(style.w*3.7));
      vec3 source=sampleNoise(videoUv);
      color=mix(color,composite(color,source,style.x),style.y*u_alpha);
    }
  }
  if(u_guides>.5){
    vec2 halfPixelExtent=vec2(0.,15./(u_cssSize.y*logoSize.y));
    color=mix(color,vec3(.05,.65,.75),boxEdge(logoUv,vec2(-.2,.489)-halfPixelExtent,vec2(1.2,.619)+halfPixelExtent));
    color=mix(color,vec3(.85,.22,.5),boxEdge(logoUv,vec2(.28,.195)-halfPixelExtent*.5,vec2(.71,.238)+halfPixelExtent*.5));
    color=mix(color,vec3(.6),boxEdge(logoUv,vec2(0.),vec2(1.)));
    for(int region=0;region<12;region++){
      vec4 area=u_areas[region];
      vec3 guide=mix(vec3(.72),region<9?vec3(.05,.55,.75):vec3(.85,.25,.52),u_areaState[region].x);
      color=mix(color,guide,boxEdge(logoUv,area.xy-area.zw*.5,area.xy+area.zw*.5));
    }
  }
  gl_FragColor=vec4(color,1.);
}`;

