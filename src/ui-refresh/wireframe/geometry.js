// Preview geometry only. Game legality and state remain owned by the runtime.
// Coordinates are board-local; card shape, hit area and arrow anchors share this projection.
export const CARD = Object.freeze({ width: 124, height: 198.4, pitch: 165 });
export const BOARD_CAMERA = Object.freeze({ distance: 12.4, fov: 38 });
export function project(x, y, z = 0) {
  // Same camera as board-scene.js. SVG hit areas, cards and WebGL never use
  // separate perspective approximations, including during pan and zoom.
  const dy = (y - 450) / 100, height = z / 100, q = Math.SQRT1_2;
  const depth = Math.SQRT2 * BOARD_CAMERA.distance - (dy + height) * q;
  const focal = 450 / Math.tan(BOARD_CAMERA.fov * Math.PI / 360);
  return { x: 800 + (x - 525) / 100 * focal / depth,
    y: 450 + (dy - height) * q * focal / depth };
}
export function rectangle(cx, cy, width, height, horizontal = false, z = 0) {
  const w = horizontal ? height : width, h = horizontal ? width : height;
  return [[cx-w/2,cy-h/2],[cx+w/2,cy-h/2],[cx+w/2,cy+h/2],[cx-w/2,cy+h/2]].map(([x,y]) => project(x,y,z));
}
// Display thickness is exaggerated for readability, not a physical measurement.
export const pileHeight = count => count > 0 ? Math.min(60, 4 + (count - 1) * 1.15) : 0;
export function cardSolid(cx, cy, css = 'card-line', horizontal = false, count = 1) {
  const height = pileHeight(count);
  const bottom = rectangle(cx, cy, CARD.width, CARD.height, horizontal);
  if (!height) return `<polygon class="slot empty-pile" points="${points(bottom)}"/>`;
  const top = rectangle(cx, cy, CARD.width, CARD.height, horizontal, height);
  const polygon = (corners, name) => `<polygon class="${name}" points="${points(corners)}"/>`;
  // Far sides first, front side last; the top face covers hidden edges.
  const sides = [[0,1],[3,0],[1,2],[2,3]].map(([a,b]) =>
    polygon([bottom[a],bottom[b],top[b],top[a]], 'solid-side')).join('');
  const seams = Array.from({length: Math.min(12, Math.max(0,count-1))});
  const lines = seams.map((_, i) => {
    const layer = rectangle(cx,cy,CARD.width,CARD.height,horizontal,height*(i+1)/(seams.length+1));
    return `<polyline class="solid-seam" points="${points([layer[1],layer[2],layer[3]])}"/>`;
  }).join('');
  return `<g class="card-solid" data-stack-count="${count}" data-stack-height="${height}">${sides}${lines}${polygon(top,css)}</g>`;
}
export const points = corners => corners.map(p => `${p.x},${p.y}`).join(' ');
export function boardSlots(users) {
  return [{seatId:'enemy',zone:'back',y:84},{seatId:'enemy',zone:'front',y:320},
    {seatId:'self',zone:'front',y:580},{seatId:'self',zone:'back',y:816}].flatMap(row => {
    const count = users[row.seatId][`${row.zone}Limit`];
    return Array.from({length:count},(_,i) => ({...row,slot:i+1,
      // Keep the center slot anchored; even counts take the extra slot on the owner's left.
      x:525 + (row.seatId === 'enemy' ? -1 : 1) * (i-Math.floor(count/2))*CARD.pitch}));
  });
}
export function slotKey(slot) { return `${slot.seatId}:${slot.zone}:${slot.slot}`; }
