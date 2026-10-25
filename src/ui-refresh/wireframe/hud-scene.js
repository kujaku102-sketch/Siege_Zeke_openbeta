import * as THREE from 'three';
import { HUD_ICONS } from './controls-view.js';
import { DEFAULT_RENDER_QUALITY, renderResolution, observeDrawing, drawingLimit, watchContextLoss } from './render-resolution.js';

// PS1-style drawing of the TURN button, the three hex buttons and the memory
// gauge, on one canvas behind the turn controls. The buttons stay HTML (clicks, focus, labels, hit
// shape); losing WebGL leaves the CSS buttons in place.

// One low-res pixel per this many css px, chosen so a hex is ~36 texels tall on any screen.
export const HEX_TEXELS = 36;
export function hexPixelScale(hexHeight) {
  return hexHeight > 0 && Number.isFinite(hexHeight) ? Math.max(1, hexHeight / HEX_TEXELS) : 1;
}

// What a button looks like right now, read from the DOM and nothing else.
export function hexButtonState(button, root) {
  if (button.disabled) return 'disabled';
  if (button.matches(':active') || (button.matches('[data-runtime-counts]') && root?.hasAttribute?.('data-count-peek'))) return 'pressed';
  if (button.matches(':hover, :focus-visible')) return 'hover';
  return 'normal';
}

const LOOKS = {
  log: { rim: '#00ff00', face: ['#0c1a0c', '#030603'], ink: '#00ff00', ring: true },
  info: { rim: '#2ce8ff', face: ['#86f2ff', '#3fd2ea'], ink: '#05141a' },
  zones: { rim: '#00ff00', face: ['#5cff3c', '#16c80e'], ink: '#03200a' },
};
// HUD_ICONS holds SVG markup; the canvas needs just the path data.
const iconPath = kind => new Path2D([...HUD_ICONS[kind].matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join(' '));
const kindOf = button => button.classList.contains('wf-turn') ? 'turn' : button.classList.contains('wf-log') ? 'log' : button.classList.contains('wf-information') ? 'info' : 'zones';

const VERTEX = `
  uniform vec2 uSnap; uniform vec3 uLight;
  out vec3 vUvAffine; out float vShade;
  void main(){
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    p.xy = floor(p.xy / p.w * uSnap + .5) / uSnap * p.w;
    gl_Position = p;
    vShade = .38 + .78 * max(dot(normalize(mat3(modelMatrix) * normal), uLight), 0.);
    vUvAffine = vec3(uv * p.w, p.w);
  }`;
// Interpolating uv*w and w then dividing gives screen-linear (affine) texturing.
const FRAGMENT = `
  uniform vec3 uColor; uniform sampler2D uMap; uniform float uHasMap; uniform float uShade; uniform float uGlow;
  in vec3 vUvAffine; in float vShade; out highp vec4 fragColor;
  void main(){
    vec4 c = vec4(uColor, 1.);
    if(uHasMap > .5){ c = texture(uMap, vUvAffine.xy / vUvAffine.z); if(c.a < .5) discard; }
    fragColor = vec4(mix(c.rgb, vec3(1.), uGlow) * vShade * uShade, 1.);
  }`;
const POST = `
  uniform sampler2D tScene; uniform vec2 uLow; in vec2 vUv; out highp vec4 fragColor;
  float bayer(vec2 p){ int x = int(mod(p.x, 4.)), y = int(mod(p.y, 4.));
    int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return float(m[y * 4 + x]) / 16. - .5; }
  void main(){
    vec2 px = floor(vUv * uLow); vec4 c = texture(tScene, (px + .5) / uLow);
    c.rgb = clamp(floor((c.rgb + bayer(px) / 31.) * 31. + .5) / 31., 0., 1.);
    fragColor = vec4(c.rgb * c.a, c.a);
  }`;

function material(color, map = null) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uMap: { value: map }, uHasMap: { value: map ? 1 : 0 },
      uSnap: { value: new THREE.Vector2(1, 1) }, uLight: { value: new THREE.Vector3(-.45, .55, .7).normalize() }, uShade: { value: 1 }, uGlow: { value: 0 },
    },
  });
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const bayer = (x, y) => [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;
// The face as a 40x35 texture: dithered two-tone fill, optional rim, icon, hard alpha.
function faceTexture(doc, look, kind, disabled) {
  const w = 40, h = 35, canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(w, h);
  const [top, bottom] = disabled ? [rgb('#59645e'), rgb('#2a322d')] : look.face.map(rgb), rim = rgb(disabled ? '#3d4a43' : look.rim);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = Math.abs((x + .5) / w * 2 - 1), v = Math.abs((y + .5) / h * 2 - 1);
    if (u > 1 - v * .5) continue;
    const ring = look.ring && (v > .82 || u > 1 - v * .5 - .14);
    const c = ring ? rim : y / (h - 1) > bayer(x, y) ? bottom : top, i = (y * w + x) * 4;
    img.data.set([...c, 255], i);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = g.fillStyle = disabled ? '#9aa7a0' : look.ink; g.lineWidth = 2.6;
  if (kind === 'info') {
    g.font = 'italic bold 28px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('i', w / 2, h / 2 + 2);
  } else {
    g.save(); g.translate(w / 2 - 12.6, h / 2 - 12.6); g.scale(1.05, 1.05); g.stroke(iconPath(kind)); g.restore();
  }
  // Antialiased icon edges snap back to the nearest palette colour.
  const palette = [top, bottom, rim, rgb(disabled ? '#9aa7a0' : look.ink)], d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i + 3] < 128) { d.data[i + 3] = 0; continue; }
    let best = palette[0], dist = Infinity;
    for (const p of palette) { const e = (p[0] - d.data[i]) ** 2 + (p[1] - d.data[i + 1]) ** 2 + (p[2] - d.data[i + 2]) ** 2; if (e < dist) { dist = e; best = p; } }
    d.data.set([...best, 255], i);
  }
  g.putImageData(d, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  return texture;
}

// A unit hexagon matching the CSS clip-path (points left/right), extruded with one bevel step.
function hexGeometry() {
  const s = new THREE.Shape();
  [[-.5, 0], [-.25, .5], [.25, .5], [.5, 0], [.25, -.5], [-.25, -.5]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
  s.closePath();
  const geometry = new THREE.ExtrudeGeometry(s, { depth: .14, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 1 });
  geometry.computeVertexNormals();
  return geometry;
}

// Digits 0-9 drawn once in the display font; turn faces are composed from it.
let digitAtlas = null;
const DIGIT_W = 20, DIGIT_H = 30;
function digits(doc) {
  if (digitAtlas) return digitAtlas;
  const canvas = doc.createElement('canvas'); canvas.width = DIGIT_W * 10; canvas.height = DIGIT_H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.font = 'bold 30px Georgia, serif'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#111'; g.fillStyle = '#fff';
  for (let i = 0; i < 10; i++) { g.strokeText(String(i), i * DIGIT_W + DIGIT_W / 2, 27); g.fillText(String(i), i * DIGIT_W + DIGIT_W / 2, 27); }
  snap(g, DIGIT_W * 10, DIGIT_H, [rgb('#ffffff'), rgb('#111111')]);
  return digitAtlas = canvas;
}
function snap(g, w, h, palette) {
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i + 3] < 128) { d.data[i + 3] = 0; continue; }
    let best = palette[0], dist = Infinity;
    for (const p of palette) { const e = (p[0] - d.data[i]) ** 2 + (p[1] - d.data[i + 1]) ** 2 + (p[2] - d.data[i + 2]) ** 2; if (e < dist) { dist = e; best = p; } }
    d.data.set([...best, 255], i);
  }
  g.putImageData(d, 0, 0);
}
const TURN_LOOKS = {
  mine: { light: ['#c4c4c1', '#9a9a97'], dark: ['#8a8a87', '#666663'], body: '#6b6b69' },
  theirs: { light: ['#6d6d6b', '#4a4a48'], dark: ['#4f4f4d', '#323230'], body: '#3a3a39' },
};
// The faceted TURN face with "TURN", the number and the label baked in.
function turnTexture(doc, number, side, label) {
  const w = 84, h = 78, look = TURN_LOOKS[side], canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(w, h), tones = [...look.light, ...look.dark].map(rgb);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = Math.abs((x + .5) / w * 2 - 1), v = Math.abs((y + .5) / h * 2 - 1);
    if (u > 1 - v * .5) continue;
    const pair = x / w < .69 - .27 * (y / h) ? tones.slice(0, 2) : tones.slice(2);
    img.data.set([...(y / (h - 1) > bayer(x, y) ? pair[1] : pair[0]), 255], (y * w + x) * 4);
  }
  g.putImageData(img, 0, 0);
  g.textAlign = 'center'; g.fillStyle = side === 'mine' ? '#111' : '#d0d0ce';
  g.font = 'bold 13px Georgia, serif'; g.fillText('TURN', w / 2, 19);
  const text = String(Math.max(0, Math.floor(number)));
  const x0 = Math.round(w / 2 - text.length * (DIGIT_W - 3) / 2) - 1;
  [...text].forEach((d, i) => g.drawImage(digits(doc), Number(d) * DIGIT_W, 0, DIGIT_W, DIGIT_H, x0 + i * (DIGIT_W - 3), 22, DIGIT_W, DIGIT_H));
  g.font = /[^\x00-\x7f]/.test(label) ? '12px SZDotGothic, sans-serif' : '15px Georgia, serif';
  g.lineJoin = 'round'; g.lineWidth = 2.5; g.strokeStyle = '#111'; g.fillStyle = '#fff';
  g.strokeText(label, w / 2, 67); g.fillText(label, w / 2, 67);
  snap(g, w, h, [...tones, rgb('#111111'), rgb('#ffffff'), rgb('#d0d0ce')]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  return texture;
}
// The TURN button's clip-path hexagon (4%..96% tall), same extrusion as the small hexes.
function turnGeometry() {
  const s = new THREE.Shape();
  [[-.5, 0], [-.25, .46], [.25, .46], [.5, 0], [.25, -.46], [-.25, -.46]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
  s.closePath();
  const geometry = new THREE.ExtrudeGeometry(s, { depth: .1, bevelEnabled: true, bevelThickness: .04, bevelSize: .04, bevelSegments: 1 });
  geometry.computeVertexNormals();
  return geometry;
}

// The gauge svg's path data (M/L/H/V/Z, absolute) as one polygon.
export function pathPolygon(d) {
  const points = [], tokens = String(d).match(/[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let command = 'M', x = 0, y = 0;
  for (let i = 0; i < tokens.length;) {
    if (/[a-z]/i.test(tokens[i])) { command = tokens[i++].toUpperCase(); if (command === 'Z') continue; }
    const n = () => Number(tokens[i++]);
    if (command === 'H') x = n(); else if (command === 'V') y = n(); else if (command === 'M' || command === 'L') { x = n(); y = n(); if (command === 'M') command = 'L'; } else { i++; continue; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    points.push([x, y]);
  }
  return points;
}
// Gauge looks: each face gets a 1px outline, a highlight along its top/left, a shadow along its
// bottom/right and a dithered two-tone fill. side is the bevel colour, depth how far it stands out.
const METER = { depth: 12, side: '#e6ecee', face: { line: '#e6ecee', light: '#3a413d', fill: ['#1f2321', '#1a1d1b'], dark: '#0e100f' } };
const METER_FRONT = METER.depth * 1.25;
const CELL_LOOKS = {
  lit: { side: '#00b800', depth: 9, line: '#004d00', light: '#b6ffb6', fill: ['#00ff00', '#00d800'], dark: '#008a00' },
  spent: { side: '#7a837d', depth: 3, line: '#7a837d', light: '#323935', fill: ['#1e2320', '#1a1e1c'], dark: '#101311' },
  blank: { side: '#2f3632', depth: .6, line: '#1a1e1c', light: '#3c4540', fill: ['#2f3632', '#2a302d'], dark: '#222724' },
};
// The svg leaves a few units between cells (and a wider one at the elbow of the "く");
// with their own outlines the 3D cells sit flush. Each quad (top-left, top-right,
// bottom-right, bottom-left) grows halfway into the gap toward any neighbour above,
// below, left or right, keeping its side slopes.
export function closeGaps(cells, gap = 8) {
  const near = (a, b) => b > a && b - a <= gap + .5;
  // Whether a's top edge and b's bottom edge share some x.
  const facing = (a, b) => Math.min(a[1][0], b[2][0]) > Math.max(a[0][0], b[3][0]);
  const along = (p, q, dy) => [p[0] + (p[0] - q[0]) * dy / (q[1] - p[1]), p[1] - dy];
  return cells.map(cell => {
    if (cell.length !== 4) return cell;
    let [tl, tr, br, bl] = cell.map(p => [...p]);
    for (const other of cells) {
      if (other === cell || other.length !== 4) continue;
      if (facing(cell, other) && near(other[3][1], cell[0][1])) { const d = (cell[0][1] - other[3][1]) / 2; tl = along(tl, bl, d); tr = along(tr, br, d); }
      if (facing(other, cell) && near(cell[3][1], other[0][1])) { const d = (other[0][1] - cell[3][1]) / 2; bl = along(bl, tl, -d); br = along(br, tr, -d); }
      if (Math.abs(other[0][1] - cell[0][1]) < .5 && Math.abs(other[3][1] - cell[3][1]) < .5) {
        if (near(other[1][0], cell[0][0])) { const d = (cell[0][0] - other[1][0]) / 2; tl[0] -= d; bl[0] -= d; }
        if (near(cell[1][0], other[0][0])) { const d = (other[0][0] - cell[1][0]) / 2; tr[0] += d; br[0] += d; }
      }
    }
    return [tl, tr, br, bl];
  });
}
// Svg units per texel of a gauge face; about one low-res pixel at the usual sizes.
const FACE_TEXEL = 3.5;
const inPolygon = (points, x, y) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// Which ring a texel of the polygon falls in: outline, highlight, shadow or fill (null outside).
export function faceTexels(points, width, height) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys);
  const sx = (Math.max(...xs) - x0) / width, sy = (Math.max(...ys) - y0) / height;
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && inPolygon(points, x0 + (x + .5) * sx, y0 + (y + .5) * sy);
  const out = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    out.push(!inside(x, y) ? null
      : !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1) ? 'line'
      : !inside(x, y - 2) || !inside(x - 2, y) ? 'light'
      : !inside(x, y + 2) || !inside(x + 2, y) ? 'dark' : 'fill');
  }
  return out;
}
function faceTextureFor(doc, points, box, look) {
  const w = Math.max(4, Math.round(box.w / FACE_TEXEL)), h = Math.max(4, Math.round(box.h / FACE_TEXEL));
  const canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d'), img = g.createImageData(w, h), rings = faceTexels(points, w, h);
  const fill = look.fill.map(rgb);
  // Texels just outside the polygon take the outline colour, so the cap's slanted edges never show holes.
  rings.forEach((ring, i) => {
    ring ??= 'line';
    const x = i % w, y = Math.floor(i / w);
    const c = ring === 'fill' ? (y / (h - 1) > bayer(x, y) ? fill[1] : fill[0]) : rgb(look[ring]);
    img.data.set([...c, 255], i * 4);
  });
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  return texture;
}
const METER_W = 300, METER_H = 360;
// Shape in svg units, y up, centred on the bounding box; returns the centre and size too.
function meterShape(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const box = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => i ? s.lineTo(x - box.cx, box.cy - y) : s.moveTo(x - box.cx, box.cy - y));
  s.closePath();
  return { shape: s, ...box };
}
// Extruded with the caps' uv spread over the shape's box, so a face texture fits it.
function extrude(shape, bevel, w, h) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: true, bevelThickness: .25, bevelSize: bevel, bevelSegments: 1 });
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / w + .5, position.getY(i) / h + .5);
  geometry.computeVertexNormals();
  return geometry;
}
// "+N" above the frame when more than ten are left to spend.
function extraTexture(doc, text) {
  const w = 56, h = 24, canvas = doc.createElement('canvas'); canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.font = 'bold 21px Georgia, serif'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#031203'; g.fillStyle = '#00ff00';
  g.strokeText(text, w / 2, 20); g.fillText(text, w / 2, 20);
  snap(g, w, h, [rgb('#00ff00'), rgb('#031203')]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  return texture;
}
const flashCells = sheet => [...(sheet?.textContent ?? '').matchAll(/data-mem-cell="(\d+)"/g)].map(m => Number(m[1]));
const FLASH_MS = 700;

const POSE = {
  normal: { z: 0, scale: 1, tilt: 1, shade: 1 },
  hover: { z: .1, scale: 1.06, tilt: 1.5, shade: 1.18 },
  pressed: { z: -.12, scale: .93, tilt: .25, shade: .72 },
  disabled: { z: 0, scale: 1, tilt: 1, shade: 1 },
};

// `onUsable(false|true)` reports a lost / restored context so the CSS buttons can take over.
export function createHudScene(canvas, quality = DEFAULT_RENDER_QUALITY, { onUsable = () => {} } = {}) {
  const doc = canvas.ownerDocument, win = doc.defaultView, tools = canvas.parentElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  const limit = drawingLimit(renderer);
  renderer.autoClear = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(14, 1, 1, 10);
  const geometry = hexGeometry(), turnShape = turnGeometry(), textures = new Map(), meshes = new Map();
  const target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const post = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, transparent: true, premultipliedAlpha: true, fragmentShader: POST,
    vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2., 0., 1.); }',
    uniforms: { tScene: { value: target.texture }, uLow: { value: new THREE.Vector2(1, 1) } },
  });
  const postScene = new THREE.Scene(), postCamera = new THREE.Camera();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), post));
  let root = null, sway = false, frame = 0, lastSway = 0, disposed = false;
  // The gauge: one frame mesh, one mesh per cell (rebuilt only if the svg's paths change), the "+N" plate.
  const meter = { group: new THREE.Group(), frame: null, cells: [], key: '', extra: null, extraText: '', sheet: null, flash: [], flashAt: 0, flashFrame: 0 };
  meter.group.visible = false; scene.add(meter.group);
  const meterMaterials = () => [meter.frame, ...meter.cells, meter.extra].filter(Boolean).flatMap(mesh => [].concat(mesh.material));
  function clearMeter() {
    for (const mesh of [meter.frame, ...meter.cells]) if (mesh) { meter.group.remove(mesh); mesh.geometry.dispose(); [].concat(mesh.material).forEach(m => m.dispose()); Object.values(mesh.userData.faces ?? {}).forEach(t => t.dispose()); }
    meter.frame = null; meter.cells = []; meter.key = '';
  }
  function buildMeter(svg) {
    const outer = svg.querySelector('path:not([data-mem-cell])')?.getAttribute('d') ?? '';
    const cells = [...svg.querySelectorAll('[data-mem-cell]')].sort((a, b) => a.dataset.memCell - b.dataset.memCell);
    const key = outer + cells.map(c => c.getAttribute('d')).join('|');
    if (key === meter.key) return cells;
    clearMeter(); meter.key = key;
    const framePoints = pathPolygon(outer), frame = meterShape(framePoints);
    const frameFace = faceTextureFor(doc, framePoints, frame, METER.face);
    meter.frame = new THREE.Mesh(extrude(frame.shape, 2.2, frame.w, frame.h), [material('#ffffff', frameFace), material(METER.side)]);
    meter.frame.userData = { faces: { frame: frameFace } };
    meter.frame.position.set(frame.cx - METER_W / 2, METER_H / 2 - frame.cy, 0); meter.frame.scale.z = METER.depth;
    meter.group.add(meter.frame);
    for (const points of closeGaps(cells.map(cell => pathPolygon(cell.getAttribute('d'))))) {
      const shape = meterShape(points);
      const faces = Object.fromEntries(Object.entries(CELL_LOOKS).map(([state, look]) => [state, faceTextureFor(doc, points, shape, look)]));
      const mesh = new THREE.Mesh(extrude(shape.shape, 1, shape.w, shape.h), [material('#ffffff', faces.blank), material(CELL_LOOKS.blank.side)]);
      mesh.userData = { ...shape, faces }; mesh.position.set(shape.cx - METER_W / 2, METER_H / 2 - shape.cy, METER_FRONT);
      meter.group.add(mesh); meter.cells.push(mesh);
    }
    return cells;
  }
  function drawMeter(box, low, t, now) {
    const svg = tools.querySelector('.wf-meter'), rect = svg?.getBoundingClientRect();
    if (!rect?.width || !rect.height) { meter.group.visible = false; return; }
    const cells = buildMeter(svg), s = Math.min(rect.width / METER_W, rect.height / METER_H);
    meter.group.visible = true;
    meter.group.position.set(rect.left + rect.width / 2 - box.left - box.width / 2, box.top + box.height / 2 - rect.top - rect.height / 2, 0);
    meter.group.scale.set(s, s, s);
    const wobble = sway ? [Math.cos(t * 1.9 + 4.1) * .03, Math.sin(t * 1.5 + 5.3) * .05] : [0, 0];
    meter.group.rotation.set(-.12 + wobble[0], -.2 + wobble[1], 0);
    // A just-spent cell flashes white and fades to grey, while the effects layer says so.
    const sheet = doc.head?.querySelector('style[data-fx-memory]') ?? null;
    if (sheet && sheet !== meter.sheet) { meter.flash = flashCells(sheet); meter.flashAt = now; }
    meter.sheet = sheet;
    const flashing = meter.flash.length && now - meter.flashAt < FLASH_MS, fade = flashing ? 1 - (now - meter.flashAt) / FLASH_MS : 0;
    if (!flashing) meter.flash = [];
    cells.forEach((cell, i) => {
      const mesh = meter.cells[i], state = CELL_LOOKS[cell.dataset.memState] ? cell.dataset.memState : 'blank', { side, depth } = CELL_LOOKS[state];
      const glow = meter.flash.includes(i) ? fade : 0;
      mesh.scale.set(1, 1, glow ? Math.max(depth, 6 * glow) : depth);
      mesh.position.z = METER_FRONT + .25 * mesh.scale.z;
      mesh.material[0].uniforms.uMap.value = mesh.userData.faces[state]; mesh.material[0].uniforms.uGlow.value = glow * .9;
      mesh.material[1].uniforms.uColor.value.set(side).lerp(new THREE.Color('#eaffea'), glow);
    });
    const plus = svg.querySelector('.wf-meter-extra')?.textContent.trim() ?? '';
    if (plus !== meter.extraText) {
      meter.extraText = plus;
      if (meter.extra) { meter.group.remove(meter.extra); meter.extra.material.uniforms.uMap.value?.dispose(); meter.extra.material.dispose(); meter.extra.geometry.dispose(); meter.extra = null; }
      if (plus) {
        meter.extra = new THREE.Mesh(new THREE.PlaneGeometry(112, 48), material('#ffffff', extraTexture(doc, plus)));
        meter.extra.position.set(147 - METER_W / 2, METER_H / 2 + 22, METER_FRONT + 2); meter.group.add(meter.extra);
      }
    }
    for (const m of meterMaterials()) { m.uniforms.uSnap.value.set(low[0] / 2, low[1] / 2); m.uniforms.uShade.value = 1; }
    if (flashing && !meter.flashFrame) meter.flashFrame = win.requestAnimationFrame(next => { meter.flashFrame = 0; draw(next); });
  }

  function textureFor(kind, disabled) {
    const key = `${kind}:${disabled}`;
    if (!textures.has(key)) textures.set(key, faceTexture(doc, LOOKS[kind], kind, disabled));
    return textures.get(key);
  }
  function turnTextureFor(button) {
    const { turn = '1', turnSide = 'mine', turnLabel = '' } = button.dataset;
    // Labels in the dot font are redrawn once it has loaded.
    const key = `turn:${turn}:${turnSide}:${turnLabel}:${doc.fonts?.check?.('12px SZDotGothic') ?? true}`;
    if (!textures.has(key)) {
      // Only the current turn face is kept.
      for (const [old, texture] of textures) if (old.startsWith('turn:')) { texture.dispose(); textures.delete(old); }
      textures.set(key, turnTexture(doc, Number(turn), turnSide === 'theirs' ? 'theirs' : 'mine', turnLabel));
    }
    return textures.get(key);
  }
  function meshFor(button) {
    if (!meshes.has(button)) {
      const group = new THREE.Group(), kind = kindOf(button), turn = kind === 'turn';
      const body = new THREE.Mesh(turn ? turnShape : geometry, material(turn ? TURN_LOOKS.mine.body : LOOKS[kind].rim));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1, turn ? .92 : 1), material('#ffffff', turn ? turnTextureFor(button) : textureFor(kind, false)));
      face.position.z = turn ? .145 : .205; group.add(body, face); scene.add(group);
      meshes.set(button, { group, body, face, kind });
    }
    return meshes.get(button);
  }

  let lost = false;
  function draw(now = win.performance.now()) {
    if (disposed || lost) return;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const size = renderResolution(box.width, box.height, quality, win.devicePixelRatio, limit);
    if (canvas.width !== size.width || canvas.height !== size.height) renderer.setSize(size.width, size.height, false);
    const buttons = [...tools.querySelectorAll('.wf-turn, .wf-hex')];
    for (const [button, entry] of meshes) if (!buttons.includes(button)) { scene.remove(entry.group); entry.body.material.dispose(); entry.face.material.dispose(); entry.face.geometry.dispose(); meshes.delete(button); }
    const hexHeight = tools.querySelector('.wf-hex')?.getBoundingClientRect().height ?? 0;
    const step = hexPixelScale(hexHeight), low = [Math.max(1, Math.round(box.width / step)), Math.max(1, Math.round(box.height / step))];
    // Camera whose z=0 plane maps one world unit to one css px of the canvas.
    camera.aspect = box.width / box.height; camera.position.set(0, 0, box.height / 2 / Math.tan(7 * Math.PI / 180));
    camera.near = camera.position.z - box.height; camera.far = camera.position.z + box.height; camera.updateProjectionMatrix();
    const t = now / 1000;
    buttons.forEach((button, index) => {
      const entry = meshFor(button), rect = button.getBoundingClientRect(), state = hexButtonState(button, root), pose = POSE[state];
      const cx = rect.left + rect.width / 2 - box.left - box.width / 2, cy = box.top + box.height / 2 - rect.top - rect.height / 2;
      const wobble = sway && state !== 'pressed' ? [Math.cos(t * 2.1 + index * 1.7) * .04, Math.sin(t * 1.7 + index * 2.3) * .06] : [0, 0];
      entry.group.position.set(cx, cy, pose.z * rect.width);
      entry.group.scale.set(rect.width * pose.scale, rect.height * pose.scale, rect.width * pose.scale);
      if (entry.kind === 'turn') {
        // An unpressable TURN (opponent's turn, waiting) just stays put; its face says why.
        const side = button.dataset.turnSide === 'theirs' ? 'theirs' : 'mine';
        const still = state === 'disabled' ? POSE.normal : pose;
        entry.group.position.z = still.z * rect.width * .5 + (side === 'theirs' ? -.04 * rect.width : 0);
        entry.group.scale.set(rect.width * still.scale, rect.width * still.scale, rect.width * still.scale);
        entry.group.rotation.set(-.14 * still.tilt + wobble[0] * .5, -.26 * still.tilt + wobble[1] * .5, .02);
        entry.body.material.uniforms.uColor.value.set(TURN_LOOKS[side].body);
        entry.face.material.uniforms.uMap.value = turnTextureFor(button);
        for (const m of [entry.body.material, entry.face.material]) { m.uniforms.uSnap.value.set(low[0] / 2, low[1] / 2); m.uniforms.uShade.value = still.shade * (m === entry.body.material ? .95 : 1); }
        return;
      }
      entry.group.rotation.set(-.2 * pose.tilt + wobble[0], (cx < 0 ? .26 : -.22) * pose.tilt + wobble[1], 0);
      const disabled = state === 'disabled';
      entry.body.material.uniforms.uColor.value.set(disabled ? '#3d4a43' : LOOKS[entry.kind].rim);
      entry.face.material.uniforms.uMap.value = textureFor(entry.kind, disabled);
      for (const m of [entry.body.material, entry.face.material]) { m.uniforms.uSnap.value.set(low[0] / 2, low[1] / 2); m.uniforms.uShade.value = pose.shade * (m === entry.body.material ? .9 : 1); }
    });
    drawMeter(box, low, t, now);
    target.setSize(low[0], low[1]); post.uniforms.uLow.value.set(low[0], low[1]);
    renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(postScene, postCamera);
  }

  // Idle sway runs at a PS1-ish 15fps and only while effects are on.
  function loop(now) {
    frame = 0;
    if (!sway || disposed || lost) return;
    if (now - lastSway >= 66) { lastSway = now; draw(now); }
    frame = win.requestAnimationFrame(loop);
  }
  const observer = observeDrawing(canvas, () => draw());
  const unwatch = watchContextLoss(canvas, {
    onLost() { lost = true; win.cancelAnimationFrame(frame); frame = 0; onUsable(false); },
    onRestored() { lost = false; onUsable(true); observer.request(); if (sway && !frame) frame = win.requestAnimationFrame(loop); }
  });
  const events = ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'focusout', 'keydown', 'keyup'];
  // State changes land after the event; redraw on the next frame.
  const changed = () => observer.request();
  for (const type of events) tools.addEventListener(type, changed);
  win.addEventListener('pointerup', changed);

  return {
    sync(nextRoot, effectsEnabled) {
      root = nextRoot;
      sway = Boolean(effectsEnabled) && !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (sway && !frame) frame = win.requestAnimationFrame(loop);
      observer.request();
    },
    dispose() {
      disposed = true; unwatch(); observer.dispose(); win.cancelAnimationFrame(frame); win.cancelAnimationFrame(meter.flashFrame);
      for (const type of events) tools.removeEventListener(type, changed);
      win.removeEventListener('pointerup', changed);
      for (const entry of meshes.values()) { entry.body.material.dispose(); entry.face.material.dispose(); entry.face.geometry.dispose(); }
      for (const texture of textures.values()) texture.dispose();
      clearMeter(); if (meter.extra) { meter.extra.material.uniforms.uMap.value?.dispose(); meter.extra.material.dispose(); meter.extra.geometry.dispose(); }
      geometry.dispose(); turnShape.dispose(); target.dispose(); post.dispose(); renderer.dispose();
    },
  };
}
