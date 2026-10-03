export const LOGO_FIT = [0.78, 0.94];
export const LOGO_EFFECT_SPEED = 2;
// Scale effect time, not rendering frequency or particle size.
export function logoEffectDelta(elapsedSeconds) {
  return Math.max(0, Math.min(elapsedSeconds, .1)) * LOGO_EFFECT_SPEED;
}
const random = (min, max, rng) => min + rng() * (max - min);
export function createLogoAreas(rng = Math.random) {
  return [
    ['S',156,154,254,271],['i',260,154,308,271],['e①',336,199,434,274],
    ['g',434,191,521,274],['e②',518,199,627,274],
    ['Z',146,270,259,348],['e③',275,270,375,348],['k',383,270,511,348],['e④',518,270,617,348],
    ['ジ',285,365,348,428],['ー',347,382,411,409],['グ',411,362,479,430]
  ].map(([name,x0,y0,x1,y1]) => {
    const area = { name, box:[((x0+x1)/2-140)/495,1-((y0+y1)/2-145)/285,(x1-x0)/495,(y1-y0)/285] };
    renewArea(area, random(-2,0,rng), rng);
    return area;
  });
}
function renewArea(area, clock, rng) {
  Object.assign(area, { start:clock, duration:random(.8,2.1,rng),quiet:random(.35,1.6,rng),strength:random(.55,1,rng),
    density:random(.45,1,rng),size:random(6,12,rng),warp:random(.25,1,rng),phase:random(0,6.28,rng),
    profile:rng()<.35?1:0,seed:random(1,1000,rng) });
}
export function updateLogoAreas(areas, clock, profile = 'random', rng = Math.random) {
  const state = new Float32Array(48), profiles = new Float32Array(48);
  areas.forEach((area,i) => {
    if(clock-area.start>=area.duration+area.quiet) renewArea(area,clock,rng);
    const progress=(clock-area.start)/area.duration;
    const fade=Math.max(0,Math.min(1,progress/.18,(1-progress)/.22));
    const strength=area.strength*fade*fade*(3-2*fade);
    const density=area.density*(.7+.3*(.5+.5*Math.sin(clock*2.3+area.phase)));
    const warp=area.warp*(.4+.6*(.5+.5*Math.sin(clock*3.1+area.phase)));
    state.set([strength,density,area.size,warp],i*4);
    profiles.set([profile==='mosaic'?1:profile==='distress'?0:area.profile,area.seed,0,0],i*4);
  });
  return { state, profiles };
}
export function createLogoBands(rng = Math.random) {
  const rand = (a,b) => random(a,b,rng);
  const bands = Array.from({length:16},(_,i)=>({
    x:.5+rand(-.13,.13),y:.554+(i-7.5)*.0078,width:i<3?rand(1,1.2):rand(.35,1.02),
    maxHeightPx:30,skew:rand(-.35,.35),phase:rand(0,6.28),offset:rng(),mode:[1,0,5,1][i%4],opacity:rand(.65,.98)
  }));
  bands.push(...Array.from({length:3},(_,i)=>({x:.49+rand(-.008,.008),y:.211+i*.006,width:rand(.39,.42),
    maxHeightPx:15,skew:rand(-.15,.15),phase:rand(0,6.28),offset:rng(),mode:1,opacity:.95})));
  [[336,369],[343,367],[465,369],[472,367]].forEach(([x,y])=>bands.push({
    vertical:true,x:(x-140)/495,y:1-(y-145)/285,width:2.5/495,height:9/285,skew:.14,
    phase:rand(0,6.28),offset:rng(),mode:1,opacity:1
  }));
  return bands;
}
export function updateLogoBands(bands, clock, nextPattern, width, height) {
  const positions=new Float32Array(92),styles=new Float32Array(92);
  const logoHeight=Math.max(1,Math.min(width*LOGO_FIT[0]/(495/285),height*LOGO_FIT[1]));
  const envelope=.78+.22*Math.sin(Math.PI*Math.max(0,Math.min(1,1-(nextPattern-clock))));
  bands.forEach((band,i)=>{
    const wave=Math.sin(clock*9+band.phase),vertical=Boolean(band.vertical);
    const thickness=vertical?band.height*(1+Math.sin(clock*12+band.phase)*.18)
      :(3+(band.maxHeightPx-3)*Math.pow(.5+.5*Math.sin(clock*5+band.phase),2))/logoHeight;
    positions.set([band.x+wave*(vertical?.0008:.008),band.y+Math.sin(clock*4+band.phase)*.001,
      band.width*(1+wave*(vertical?.07:.14)),thickness],i*4);
    styles.set([band.mode,band.opacity*envelope,band.skew+wave*.04,band.offset+clock*.035],i*4);
  });
  return { positions, styles };
}
