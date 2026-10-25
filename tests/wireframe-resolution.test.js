import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RENDER_QUALITY, RENDER_QUALITY_PRESETS, renderQualityFor, renderResolution, observeDrawing } from '../src/ui-refresh/wireframe/render-resolution.js';
import { attachLifeView } from '../src/ui-refresh/wireframe/life-view.js';
import { createSurfaceScenes } from '../src/ui-refresh/surface-scenes.js';
import { attachBoardCamera } from '../src/ui-refresh/wireframe/camera.js';
import { hexPixelScale, hexButtonState, HEX_TEXELS, pathPolygon, faceTexels, closeGaps } from '../src/ui-refresh/wireframe/hud-scene.js';
import { METER_OUTER, CELL_PATHS } from '../src/ui-refresh/wireframe/memory-meter.js';
import { activeTurnCount } from '../src/ui-refresh/wireframe/controls-view.js';

test('board camera works without a control panel: wheel, drag, pinch and disposal', () => {
  const oldWindow=globalThis.window, oldObserver=globalThis.ResizeObserver;
  const listeners=new Map(), attributes=new Map(); let disconnected=false;
  const board={addEventListener(type,fn){listeners.set(type,fn);},
    getBoundingClientRect:()=>({left:0,top:0,width:800,height:450}),
    setAttribute(k,v){attributes.set(k,v);},dispatchEvent(){},classList:{add(){},remove(){}},
    setPointerCapture(){},hasPointerCapture:()=>false};
  globalThis.window={addEventListener(type,fn){listeners.set(type,fn);}};
  globalThis.ResizeObserver=class {observe(){} disconnect(){disconnected=true;}};
  const event=(x,y,id=1)=>({button:0,pointerId:id,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});
  try {
    const camera=attachBoardCamera(board);
    const initial=attributes.get('viewBox');
    listeners.get('wheel')({...event(400,225),deltaY:-100,deltaMode:0});
    const zoomed=attributes.get('viewBox'); assert.notEqual(zoomed,initial);
    listeners.get('pointerdown')(event(400,225));listeners.get('pointermove')(event(430,235));
    const dragged=attributes.get('viewBox');assert.notEqual(dragged,zoomed);
    listeners.get('pointerup')(event(430,235));
    listeners.get('pointerdown')(event(350,225));listeners.get('pointerdown')(event(450,225,2));
    listeners.get('pointermove')(event(490,225,2));assert.notEqual(attributes.get('viewBox'),dragged);
    camera.refresh();camera.dispose();assert.equal(disconnected,true);
  } finally {globalThis.window=oldWindow;globalThis.ResizeObserver=oldObserver;}
});

test('high quality changes buffer only and is independent of DPR', () => {
  for (const dpr of [1, 2, 3]) {
    assert.deepEqual(renderResolution(800,360,undefined,dpr), {width:2400,height:1080,scale:3});
    assert.deepEqual(renderResolution(640,288,undefined,dpr), {width:1920,height:864,scale:3});
  }
  assert.equal(renderResolution(800,360,{scale:'device'},1).width,800);
  assert.equal(renderResolution(800,360,{scale:'device'},3).width,1600);
});
test('render quality presets: compat draws at CSS pixels on any DPR, full keeps the default', () => {
  assert.equal(renderQualityFor('full'), DEFAULT_RENDER_QUALITY);
  assert.deepEqual(RENDER_QUALITY_PRESETS.full, { scale: 3, maxPixels: 8_294_400 });
  assert.deepEqual(renderQualityFor('compat'), { scale: 1, maxPixels: 8_294_400 });
  for (const mode of [undefined, null, '', 'auto', 'COMPAT']) assert.equal(renderQualityFor(mode), DEFAULT_RENDER_QUALITY);
  assert.ok(Object.isFrozen(RENDER_QUALITY_PRESETS.compat));
  for (const dpr of [1, 2, 3]) {
    assert.deepEqual(renderResolution(64, 26, renderQualityFor('compat'), dpr), { width: 64, height: 26, scale: 1 });
    assert.deepEqual(renderResolution(64, 26, renderQualityFor('full'), dpr), { width: 192, height: 78, scale: 3 });
  }
});
test('render quality: a sample scale replaces the full scale only; compat stays at 1', () => {
  assert.deepEqual(renderQualityFor('full', 0.5), { scale: 0.5, maxPixels: 8_294_400 });
  assert.deepEqual(renderQualityFor('full', 1), { scale: 1, maxPixels: 8_294_400 });
  assert.equal(renderQualityFor('full', 3), DEFAULT_RENDER_QUALITY, 'the default scale is the default preset');
  for (const scale of [null, undefined, 0, -1, NaN, Infinity, '0.5']) assert.equal(renderQualityFor('full', scale), DEFAULT_RENDER_QUALITY, String(scale));
  for (const scale of [0.25, 0.5, 1, 3]) assert.equal(renderQualityFor('compat', scale), RENDER_QUALITY_PRESETS.compat);
  assert.deepEqual(renderResolution(852, 393, renderQualityFor('full', 0.5), 2), { width: 426, height: 196, scale: 0.5 });
  assert.deepEqual(renderResolution(852, 393, renderQualityFor('full', 1), 2), { width: 852, height: 393, scale: 1 });
  // The pixel cap still wins over a large sample scale on a large screen.
  assert.ok(renderResolution(1920, 1080, renderQualityFor('full', 3), 1).width <= 3840);
});
// A seat's life canvas inside a fake match root, with frames run by hand.
function lifeHarness() {
  const old = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, observer: globalThis.ResizeObserver };
  const frames = new Map(); let id = 0;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = n => frames.delete(n);
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 300, height: 150, dataset: { lifeSeat: 'a' }, getBoundingClientRect: () => ({ width: 64, height: 26 }), getContext: () => context };
  const win = { devicePixelRatio: 3, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }) };
  // The WebGL hosts as a full-mode scene left them (DPR-independent x3 of the CSS size).
  const drawn = [{ width: 2556, height: 1179 }, { width: 551, height: 1002 }];
  const root = { ownerDocument: { defaultView: win }, querySelector: () => null,
    querySelectorAll: selector => selector === '[data-life-seat]' ? [canvas] : selector === '.wf-board-model, .wf-hud-model' ? drawn : [] };
  const model = { match: { viewerSeat: 'a' }, seats: [{ seatId: 'a', fortressStr: 12, incidents: [], user: { maxFortressStr: 20, incidents: [4] } }] };
  const flush = () => { for (let i = 0; i < 3 && frames.size; i++) { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(performance.now()); } };
  const restore = () => { globalThis.requestAnimationFrame = old.raf; globalThis.cancelAnimationFrame = old.caf; globalThis.ResizeObserver = old.observer; };
  return { canvas, root, model, drawn, flush, restore };
}
test('life view: a render mode switch resizes the canvas both ways at DPR 3', () => {
  const h = lifeHarness();
  try {
    const view = attachLifeView(h.root, renderQualityFor('compat'));
    view.sync(h.model, false); h.flush();
    assert.deepEqual([h.canvas.width, h.canvas.height], [64, 26], 'compat: CSS pixels, not DPR 3');
    view.setQuality(renderQualityFor('full')); h.flush();
    assert.deepEqual([h.canvas.width, h.canvas.height], [192, 78], 'full: the current x3 default');
    view.setQuality(renderQualityFor('compat')); h.flush();
    assert.deepEqual([h.canvas.width, h.canvas.height], [64, 26], 'back to compat shrinks again');
    view.dispose();
  } finally { h.restore(); }
});
test('surface scenes: setRenderQuality reaches the life view made before and after it', () => {
  const h = lifeHarness();
  try {
    const scenes = createSurfaceScenes({ root: h.root, boardStyle: 'classic', renderQuality: renderQualityFor('full'), latest: () => null, lowGpu: true });
    scenes.sync({ model: h.model }, false); h.flush();
    assert.equal(h.canvas.width, 192);
    scenes.setRenderQuality(renderQualityFor('compat')); h.flush();
    assert.equal(h.canvas.width, 64);
    scenes.setRenderQuality(null); h.flush();
    assert.equal(h.canvas.width, 64, 'a missing preset changes nothing');
    scenes.dispose();
    const later = createSurfaceScenes({ root: h.root, boardStyle: 'classic', renderQuality: renderQualityFor('full'), latest: () => null, lowGpu: true });
    later.setRenderQuality(renderQualityFor('compat'));
    later.sync({ model: h.model }, false); h.flush();
    assert.equal(h.canvas.width, 64, 'a life view attached after the switch starts at the new quality');
    later.dispose();
  } finally { h.restore(); }
});
test('surface scenes: going to compat shrinks the kept WebGL canvases; staying or going to full leaves them', () => {
  const h = lifeHarness();
  try {
    const scenes = createSurfaceScenes({ root: h.root, boardStyle: 'classic', renderQuality: renderQualityFor('full'), latest: () => null, lowGpu: false });
    scenes.setLowGpu(false);
    assert.deepEqual(h.drawn.map(c => [c.width, c.height]), [[2556, 1179], [551, 1002]], 'no mode change, no resize');
    scenes.setLowGpu(true);
    assert.deepEqual(h.drawn.map(c => [c.width, c.height]), [[1, 1], [1, 1]]);
    h.drawn[0].width = 2556; scenes.setLowGpu(true);
    assert.equal(h.drawn[0].width, 2556, 'already compat: untouched');
    scenes.setLowGpu(false);
    assert.equal(h.drawn[0].width, 2556, 'full: the next scene sizes its own canvas');
    scenes.dispose();
  } finally { h.restore(); }
});
test('pixel and hardware limits bound allocations, zero size skips drawing', () => {
  for(const [w,h] of [[1920,1080],[3840,2160],[800,360]]) {
    const size=renderResolution(w,h);
    assert.ok(size.width*size.height<=8_294_400);
    assert.ok(Math.abs(size.width/size.height-w/h)<.01);
  }
  const smallGpu=renderResolution(800,360,undefined,3,1024);
  assert.equal(smallGpu.width,1024);
  assert.ok(smallGpu.height<=1024);
  for(const [w,h] of [[0,360],[800,0],[-1,2],[Infinity,1]]) assert.equal(renderResolution(w,h),null);
});
test('DPR changes schedule drawing and disposal removes observers', () => {
  const old=globalThis.ResizeObserver;
  let resize, removed=0, drawCount=0, disconnected=false, frame=0;
  const frames=new Map(), medias=[];
  const win={devicePixelRatio:1,requestAnimationFrame(fn){frames.set(++frame,fn);return frame;},cancelAnimationFrame(id){frames.delete(id);},
    addEventListener(){},removeEventListener(){removed++;},matchMedia(){const m={addEventListener(_type,fn){this.fn=fn;},removeEventListener(){removed++;}};medias.push(m);return m;}};
  globalThis.ResizeObserver=class {constructor(fn){resize=fn;} observe(){} disconnect(){disconnected=true;}};
  try {
    const watcher=observeDrawing({ownerDocument:{defaultView:win}},()=>drawCount++);
    resize();resize();assert.equal(frames.size,1);
    const flush=()=>{const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();};
    flush();assert.equal(drawCount,1);
    win.devicePixelRatio=3;medias[0].fn();flush();assert.equal(drawCount,2);
    assert.equal(medias.length,2);
    watcher.request();watcher.dispose();assert.equal(frames.size,0);assert.ok(disconnected);assert.ok(removed>=3);
    watcher.request();assert.equal(frames.size,0);
  } finally {globalThis.ResizeObserver=old;}
});

test('PS1 hex buttons keep the same texel size on any screen and read state from the DOM only', () => {
  assert.equal(hexPixelScale(HEX_TEXELS * 3), 3);
  assert.equal(hexPixelScale(HEX_TEXELS / 2), 1);
  assert.equal(hexPixelScale(0), 1);assert.equal(hexPixelScale(NaN), 1);
  const button=(flags={},counts=false)=>({disabled:Boolean(flags.disabled),
    matches:selector=>selector==='[data-runtime-counts]'?counts:selector.split(',').some(part=>flags[part.trim().slice(1)])});
  const root=peek=>({hasAttribute:name=>peek&&name==='data-count-peek'});
  assert.equal(hexButtonState(button({disabled:true,hover:true}),root(false)),'disabled');
  assert.equal(hexButtonState(button({active:true}),root(false)),'pressed');
  assert.equal(hexButtonState(button({},true),root(true)),'pressed');
  assert.equal(hexButtonState(button({},false),root(true)),'normal');
  assert.equal(hexButtonState(button({'focus-visible':true}),root(false)),'hover');
  assert.equal(hexButtonState(button({hover:true}),root(false)),'hover');
});

test('TURN counts the active side\'s own turns, not the match-wide number', () => {
  const model=(active,a,b,turnNumber=7)=>({match:{activeSeat:active,turnNumber},seats:[{seatId:'seat-a',turnsTaken:a},{seatId:'seat-b',turnsTaken:b}]});
  assert.equal(activeTurnCount(model('seat-a',4,3)),4);
  assert.equal(activeTurnCount(model('seat-b',4,3)),3);
  assert.equal(activeTurnCount(model('seat-a',0,0,1)),1);
  assert.equal(activeTurnCount({match:{activeSeat:'seat-a',turnNumber:5},seats:[{seatId:'seat-a'}]}),5);
});

test('the 3D memory gauge reads the svg paths as polygons', () => {
  assert.deepEqual(pathPolygon(METER_OUTER), [[108,8],[186,8],[53,188],[143,338],[267,338],[267,350],[128,350],[3,188]]);
  assert.deepEqual(pathPolygon('M1 2H5L6 7H0Z'), [[1,2],[5,2],[6,7],[0,7]]);
  for (const d of CELL_PATHS) assert.equal(pathPolygon(d).length, 4);
  assert.deepEqual(pathPolygon(''), []);
});

test('gauge faces get an outline, a top-left highlight and a bottom-right shadow', () => {
  const rings = faceTexels([[0,0],[10,0],[10,10],[0,10]], 10, 10), at = (x, y) => rings[y * 10 + x];
  assert.equal(at(0,0), 'line'); assert.equal(at(9,5), 'line');
  assert.equal(at(1,1), 'light'); assert.equal(at(5,1), 'light');
  assert.equal(at(8,8), 'dark'); assert.equal(at(5,8), 'dark');
  assert.equal(at(5,5), 'fill');
  assert.equal(faceTexels([[0,0],[10,0],[0,10]], 10, 10)[99], null);
});

test('the 3D gauge cells sit flush with their neighbours', () => {
  const stacked = closeGaps([[[0,0],[10,0],[10,10],[0,10]], [[0,13],[10,13],[10,23],[0,23]]]);
  assert.equal(stacked[0][2][1], 11.5); assert.equal(stacked[1][0][1], 11.5);
  const side = closeGaps([[[0,0],[10,0],[14,10],[4,10]], [[13,0],[23,0],[27,10],[17,10]]]);
  assert.equal(side[0][1][0], 11.5); assert.equal(side[1][0][0], 11.5);
  const cells = closeGaps(CELL_PATHS.map(pathPolygon));
  // The elbow: the upper arm's lowest cell meets the lower arm's top cell.
  assert.ok(Math.abs(cells[5][0][1] - cells[6][3][1]) < 1e-9);
  for (let i = 2; i < 9; i++) assert.ok(Math.abs(cells[i][3][1] - cells[i + 1][0][1]) < 1e-9 || Math.abs(cells[i + 1][3][1] - cells[i][0][1]) < 1e-9);
  assert.ok(Math.abs(cells[0][0][0] - cells[1][1][0]) < 1e-9);
});

test('a re-render keeps what a scene set on its own node (canvas size, WebGL tag, drawn class)', async () => {
  const { syncAttributes } = await import('../src/ui-refresh/dom-patch.js');
  const node = attrs => {
    const map = new Map(Object.entries(attrs));
    return { get attributes() { return [...map].map(([name, value]) => ({ name, value })); },
      hasAttribute: name => map.has(name), getAttribute: name => map.get(name) ?? null,
      setAttribute: (name, value) => map.set(name, String(value)), removeAttribute: name => map.delete(name),
      classList: { contains: name => (map.get('class') ?? '').split(' ').includes(name) }, map };
  };
  const canvas = node({ class: 'wf-hud-model', 'data-patch-keep': 'width height data-engine', width: '1088', height: '2313', 'data-engine': 'three.js r180' });
  syncAttributes(canvas, node({ class: 'wf-hud-model', 'data-patch-keep': 'width height data-engine', 'aria-hidden': 'true' }));
  assert.deepEqual([canvas.getAttribute('width'), canvas.getAttribute('height'), canvas.getAttribute('data-engine'), canvas.getAttribute('aria-hidden')], ['1088', '2313', 'three.js r180', 'true']);
  const section = node({ class: 'wf-turn-controls wf-hud-rendered stale', 'data-patch-keep': 'class:wf-hud-rendered' });
  syncAttributes(section, node({ class: 'wf-turn-controls', 'data-patch-keep': 'class:wf-hud-rendered' }));
  assert.equal(section.getAttribute('class'), 'wf-turn-controls wf-hud-rendered');
  // Nodes without the list are synced as before.
  const plain = node({ class: 'a b', title: 'x' });
  syncAttributes(plain, node({ class: 'a' }));
  assert.deepEqual([plain.getAttribute('class'), plain.hasAttribute('title')], ['a', false]);
});

test('board camera: a lost pointer no longer blocks taps; two fingers and a drag still stop the click', () => {
  const oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  globalThis.window = new EventTarget();
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const board = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }), setAttribute() {},
    classList: { add() {}, remove() {} }, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {}
  });
  let reached = 0;
  const pointer = (type, target, props) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }),
    { button: 0, clientX: 100, clientY: 100, ...props }));
  const tap = (pointerId, x = 100, y = 100) => {
    pointer('pointerdown', board, { pointerId, isPrimary: true, clientX: x, clientY: y });
    pointer('pointerup', window, { pointerId, isPrimary: true, clientX: x, clientY: y });
    board.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { detail: 1 }));
  };
  try {
    const camera = attachBoardCamera(board);
    board.addEventListener('click', () => { reached += 1; });
    tap(1);
    assert.equal(reached, 1, 'a plain tap passes');
    // A pointer whose up never reached the window (synthetic, not primary), then real taps.
    pointer('pointerdown', board, { pointerId: 77, isPrimary: false });
    tap(2); tap(3);
    assert.equal(reached, 3, 'taps after a lost pointer pass');
    // Two fingers: the second contact is not primary, so the click is still stopped.
    pointer('pointerdown', board, { pointerId: 4, isPrimary: true });
    pointer('pointerdown', board, { pointerId: 5, isPrimary: false, clientX: 200 });
    pointer('pointerup', window, { pointerId: 5 }); pointer('pointerup', window, { pointerId: 4 });
    board.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { detail: 1 }));
    assert.equal(reached, 3, 'a pinch does not select');
    tap(6);
    assert.equal(reached, 4, 'the next tap after a pinch passes');
    // A drag of 7px or more moves the camera instead of selecting.
    pointer('pointerdown', board, { pointerId: 7, isPrimary: true });
    pointer('pointermove', board, { pointerId: 7, isPrimary: true, clientX: 130, clientY: 110 });
    pointer('pointerup', window, { pointerId: 7, clientX: 130, clientY: 110 });
    board.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { detail: 1 }));
    assert.equal(reached, 4, 'a drag does not select');
    // A capture lost mid-drag ends that drag, so the next tap is a tap.
    pointer('pointerdown', board, { pointerId: 8, isPrimary: true });
    pointer('pointermove', board, { pointerId: 8, isPrimary: true, clientX: 140, clientY: 110 });
    pointer('lostpointercapture', board, { pointerId: 8 });
    tap(9);
    assert.equal(reached, 5);
    camera.dispose();
  } finally { globalThis.window = oldWindow; globalThis.ResizeObserver = oldObserver; }
});
