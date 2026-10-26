// HUD sprite sheets for the compat (no WebGL) path — V092-10, approved by 文豪.
// Each sheet is one row of four low-resolution cells (normal, hover, pressed, disabled) exported
// from the full-mode HUD; CSS (hud-sprites.css) shows the cell for the button's state, enlarged
// with image-rendering: pixelated. Text and icons stay DOM; the memory gauge stays SVG.
// `element` is the button's size and `offset` the cell's top-left from the button's, in texels.
export const HUD_SPRITE_STATES = Object.freeze(['normal', 'hover', 'pressed', 'disabled']);
export const HUD_SPRITE_SHEETS = Object.freeze([
  { name: 'log', selector: '.wf-log', url: new URL('../../assets/ui-sprites/ui-hud-log.png', import.meta.url).href,
    cell: [54, 49], sheet: [216, 49], element: [41.39, 36.01], offset: [-7.2, -6.75] },
  { name: 'info', selector: '.wf-information', url: new URL('../../assets/ui-sprites/ui-hud-info.png', import.meta.url).href,
    cell: [54, 48], sheet: [216, 48], element: [41.39, 36.01], offset: [-7.2, -6.2] },
  { name: 'zones', selector: '.wf-zones', url: new URL('../../assets/ui-sprites/ui-hud-zones.png', import.meta.url).href,
    cell: [53, 48], sheet: [212, 48], element: [41.39, 36.01], offset: [-5.26, -6.47] },
  { name: 'turn-mine', selector: '.wf-turn[data-turn-side="mine"]', url: new URL('../../assets/ui-sprites/ui-hud-turn-mine.png', import.meta.url).href,
    cell: [90, 89], sheet: [360, 89], element: [76.41, 76.47], offset: [-8.17, -7.36] },
  { name: 'turn-theirs', selector: '.wf-turn[data-turn-side="theirs"]', url: new URL('../../assets/ui-sprites/ui-hud-turn-theirs.png', import.meta.url).href,
    cell: [90, 89], sheet: [360, 89], element: [76.41, 76.47], offset: [-8.17, -7.36] }
].map(sheet => Object.freeze(sheet)));

// The sprite layer as percentages of its button, so it follows the button's relative size.
const pct = value => `${Math.round(value * 1e5) / 1e3}%`;
export function spriteBox({ cell, element, offset }) {
  return { left: pct(offset[0] / element[0]), top: pct(offset[1] / element[1]), width: pct(cell[0] / element[0]), height: pct(cell[1] / element[1]) };
}

// All sheets decoded, or false when any fails: then the CSS hexes stay (the fallback).
const decode = url => {
  try {
    const image = new Image();
    image.src = url;
    return image.decode().then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
};
let loading = null;
export function loadHudSprites(load = decode) {
  if (load !== decode) return Promise.all(HUD_SPRITE_SHEETS.map(sheet => load(sheet.url))).then(all => all.every(Boolean));
  loading ??= Promise.all(HUD_SPRITE_SHEETS.map(sheet => decode(sheet.url))).then(all => all.every(Boolean));
  return loading;
}
