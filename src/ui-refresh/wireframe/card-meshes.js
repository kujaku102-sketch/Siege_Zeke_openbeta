import * as THREE from 'three';
import { CARD, BOARD_CAMERA, pileHeight } from './geometry.js';

// Thin card slabs drawn by the 3D board. Looks only: the SVG over them keeps the
// outlines, captions and every hit area, and each slab copies whatever motion its
// SVG group is given (kicks, hiding during a flight, fades), so effects written
// for the SVG move the slab too.
// Each card is a pivot holding a box whose top is the face and bottom the back,
// so a flip is a half turn of the pivot.
const ART_SIZE = { width: 256, height: 410 }, WIDE_ART = { width: 410, height: 256 };
const COLORS = Object.freeze({ side:'#15232c', face:'#263c49', pile:'#151e25', trash:'#39243b', registry:'#3a3020' });
const Q = Math.SQRT1_2, FOCAL = 450 / Math.tan(BOARD_CAMERA.fov * Math.PI / 360);
const VIEW_AXIS = new THREE.Vector3(0, 1, 1).normalize();

// Card art ships as large PNGs; each is shrunk once per page and shared.
const artCache = new Map();
function artCanvas(url, wide, doc) {
  const key = `${wide ? 'wide' : 'tall'}:${url}`, size = wide ? WIDE_ART : ART_SIZE;
  if (!artCache.has(key)) artCache.set(key, new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = doc.createElement('canvas');
      Object.assign(canvas, size);
      const g = canvas.getContext('2d'), scale = Math.max(size.width / image.width, size.height / image.height);
      const w = image.width * scale, h = image.height * scale;
      g.drawImage(image, (size.width - w) / 2, (size.height - h) / 2, w, h);
      resolve(canvas);
    };
    image.onerror = () => { artCache.delete(key); reject(new Error(`card art ${url}`)); };
    image.src = url;
  }));
  return artCache.get(key);
}
// The same cross hatch as the SVG back pattern.
function backCanvas(doc) {
  const canvas = doc.createElement('canvas');
  canvas.width = 64; canvas.height = 102;
  const g = canvas.getContext('2d');
  g.fillStyle = '#11202c'; g.fillRect(0, 0, 64, 102);
  g.strokeStyle = '#496071'; g.lineWidth = 1;
  g.beginPath();
  for (let i = -102; i < 64; i += 8) { g.moveTo(i, 0); g.lineTo(i + 102, 102); g.moveTo(i + 102, 0); g.lineTo(i, 102); }
  g.stroke();
  return canvas;
}
const texture = canvas => {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
};
// Board units (1600x900 SVG, z up) to the board scene's world, 100 units each.
export const boardToWorld = (x, y, z = 0) => ({ x: (x - 525) / 100, y: z / 100, z: (y - 450) / 100 });
// Screen motion of an SVG group, read back onto the card's spot on the board:
// sideways stays sideways, upward becomes a lift, a screen spin turns about the view.
export function screenToWorld(piece, dx, dy) {
  const at = boardToWorld(piece.x, piece.y, pileHeight(piece.count));
  const depth = Math.SQRT2 * BOARD_CAMERA.distance - (at.z + at.y) * Q;
  const along = dy * depth / (FOCAL * Q);
  // Up the screen lifts the card; down the screen slides it toward the viewer.
  return { x: dx * depth / FOCAL, lift: Math.max(0, -along), z: Math.max(0, along) };
}
export function readMotion(style) {
  const hidden = style.visibility === 'hidden' || style.display === 'none';
  const opacity = Number.parseFloat(style.opacity);
  const m = /^matrix\(([^)]+)\)$/.exec(style.transform ?? '')?.[1].split(',').map(Number);
  return { hidden, opacity: Number.isFinite(opacity) ? opacity : 1,
    dx: m?.[4] ?? 0, dy: m?.[5] ?? 0, angle: m ? Math.atan2(m[1], m[0]) : 0, scale: m ? Math.hypot(m[0], m[1]) : 1 };
}

export function createCardMeshes(scene, doc) {
  const pieces = new Map();
  const back = texture(backCanvas(doc));
  const side = new THREE.MeshLambertMaterial({ color: COLORS.side, flatShading: true });
  const plain = Object.fromEntries(['face','pile','trash','registry'].map(key => [key, new THREE.MeshBasicMaterial({ color: COLORS[key] })]));
  const backFace = new THREE.MeshBasicMaterial({ map: back });
  const arts = new Map();
  let changed = () => {};
  const artMaterial = (url, wide) => {
    const key = `${wide}:${url}`;
    if (!arts.has(key)) {
      const material = new THREE.MeshBasicMaterial({ color: COLORS.face });
      arts.set(key, material);
      artCanvas(url, wide, doc).then(canvas => {
        if (!arts.has(key)) return;
        material.map = texture(canvas); material.color.set('#ffffff'); material.needsUpdate = true; changed();
      }, () => { /* the plain face stays */ });
    }
    return arts.get(key);
  };
  const faceOf = piece => {
    if (piece.kind === 'deck') return plain.pile;
    if (piece.kind === 'trash') return plain.trash;
    if (piece.faceDown) return backFace;
    if (piece.art) return artMaterial(piece.art, piece.horizontal && !piece.turned);
    return piece.kind === 'registry' ? plain.registry : plain.face;
  };
  const build = piece => {
    // Code and Plugin art is landscape; a sleeping unit is a portrait card turned on its side.
    const wide = piece.horizontal && !piece.turned;
    const w = (wide ? CARD.height : CARD.width) / 100, d = (wide ? CARD.width : CARD.height) / 100;
    const t = pileHeight(piece.count) / 100;
    const face = faceOf(piece), bottom = ['card','registry'].includes(piece.kind) && !piece.faceDown ? backFace : face;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), [side, side, face, bottom, side, side]);
    box.position.y = t / 2;
    const pivot = new THREE.Group();
    pivot.add(box);
    pivot.userData = { signature: signature(piece), box };
    return pivot;
  };
  const signature = piece => [piece.kind, piece.count, piece.faceDown, piece.art, piece.horizontal, piece.turned].join('|');
  const place = (pivot, piece) => {
    const at = boardToWorld(piece.x, piece.y);
    pivot.userData.piece = piece; pivot.userData.state = null;
    pivot.userData.home = new THREE.Vector3(at.x, at.y, at.z);
    pivot.userData.turn = piece.turned ? -Math.PI / 2 : 0;
    pivot.position.copy(pivot.userData.home);
    pivot.rotation.set(0, pivot.userData.turn, 0);
  };
  const drop = key => {
    const pivot = pieces.get(key);
    const { box, own } = pivot.userData;
    scene.remove(pivot); box.geometry.dispose(); pieces.delete(key);
    if (own) for (const material of box.material) material.dispose();
  };
  return {
    onChange(fn) { changed = fn; },
    // Lays out the slabs for the current board; cards keep their slab when they move.
    sync(next) {
      const seen = new Set();
      for (const piece of next) {
        seen.add(piece.key);
        let pivot = pieces.get(piece.key);
        if (pivot && pivot.userData.signature !== signature(piece)) { drop(piece.key); pivot = null; }
        if (!pivot) { pivot = build(piece); pieces.set(piece.key, pivot); scene.add(pivot); }
        place(pivot, piece);
      }
      for (const key of [...pieces.keys()]) if (!seen.has(key)) drop(key);
    },
    // Copies the motion of each slab's SVG group; true when anything moved.
    follow(svg) {
      const view = svg.ownerDocument.defaultView;
      let moved = false;
      for (const pivot of pieces.values()) {
        const { piece, home, turn, box } = pivot.userData;
        const node = svg.querySelector(piece.node);
        const motion = node ? readMotion(view.getComputedStyle(node)) : readMotion({});
        const shift = screenToWorld(piece, motion.dx, motion.dy);
        const state = [motion.hidden, motion.opacity, shift.x, shift.lift, shift.z, motion.angle, motion.scale].join(',');
        if (pivot.userData.state === state) continue;
        pivot.userData.state = state; moved = true;
        pivot.visible = !motion.hidden && motion.opacity > .01;
        pivot.position.set(home.x + shift.x, home.y + shift.lift, home.z + shift.z);
        pivot.quaternion.setFromAxisAngle(VIEW_AXIS, -motion.angle).multiply(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn));
        pivot.scale.setScalar(motion.scale);
        // Materials are shared, so a slab that fades draws through its own copies.
        const fading = motion.opacity < 1;
        if (fading && !pivot.userData.own) { pivot.userData.own = true; box.material = box.material.map(m => m.clone()); }
        if (pivot.userData.own) for (const material of box.material) {
          if (material.transparent !== fading) { material.transparent = fading; material.needsUpdate = true; }
          material.opacity = motion.opacity;
        }
      }
      return moved;
    },
    dispose() {
      for (const key of [...pieces.keys()]) drop(key);
      back.dispose(); side.dispose(); backFace.dispose();
      for (const m of Object.values(plain)) m.dispose();
      for (const m of arts.values()) { m.map?.dispose(); m.dispose(); }
      arts.clear();
    }
  };
}
