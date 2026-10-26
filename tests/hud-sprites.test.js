import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HUD_SPRITE_SHEETS, HUD_SPRITE_STATES, spriteBox, loadHudSprites } from '../src/ui-refresh/wireframe/hud-sprites.js';
import { wireframeControlsHtml } from '../src/ui-refresh/wireframe/controls-view.js';
import { createSurfaceScenes } from '../src/ui-refresh/surface-scenes.js';

// V092-10 (approved by 文豪): the sheets as exported by sz-qa (D:\work\sprite-assets\manifest.json).
const EXPORTED = {
  'ui-hud-log.png': '7cf9ad95fa20511d7be84ea59dccbb1f46a0e713b653a726382dde80aeb0115b',
  'ui-hud-info.png': 'e6f794d71199e84eed6017cc9d402a14d9c07df35da7b86a87a88dcff2aa19f9',
  'ui-hud-zones.png': 'b76d25f8ff467f1d26c2c06c02b1cdab2b6f204de439459efbe81b2743ec74bf',
  'ui-hud-turn-mine.png': '32460d11653bbc1ef51def026bcb79ea91c1a4eb72f399ca5e0266539ecf4cac',
  'ui-hud-turn-theirs.png': 'af47fc7956c2cc60c527db5b635366f138c9306941d2b9e778ac118c984805d4'
};
const readSource = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const pngChunks = bytes => {
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) { const length = bytes.readUInt32BE(offset); chunks.push(bytes.toString('latin1', offset + 4, offset + 8)); offset += 12 + length; }
  return chunks;
};

test('hud sprites: five sheets of four cells each, unchanged from the export, PNG-8 with no metadata', async () => {
  assert.deepEqual([...HUD_SPRITE_STATES], ['normal', 'hover', 'pressed', 'disabled']);
  assert.deepEqual(HUD_SPRITE_SHEETS.map(sheet => sheet.name), ['log', 'info', 'zones', 'turn-mine', 'turn-theirs']);
  for (const sheet of HUD_SPRITE_SHEETS) {
    const file = new URL(sheet.url).pathname.split('/').pop();
    const bytes = await readFile(new URL(sheet.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), EXPORTED[file], `${file} is the exported file`);
    assert.equal(bytes.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], sheet.sheet, `${file} size`);
    assert.equal(sheet.sheet[0], sheet.cell[0] * 4, `${file}: one row of four cells`);
    assert.equal(bytes[25], 3, `${file} is a palette PNG`);
    assert.deepEqual(pngChunks(bytes), ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'], `${file} carries no tEXt/zTXt/iTXt/eXIf`);
    assert.ok(Object.isFrozen(sheet));
  }
});

test('hud sprites: the CSS places and switches every sheet as spriteBox says, and only under .wf-hud-sprites', async () => {
  const css = await readSource('../src/ui-refresh/hud-sprites.css');
  const rule = selector => css.split('\n').find(line => line.startsWith(`.r2-wireframe-view .wf-hud-sprites ${selector} .wf-sprite {`));
  for (const sheet of HUD_SPRITE_SHEETS.filter(sheet => sheet.name !== 'turn-theirs')) {
    const line = rule(sheet.name.startsWith('turn') ? '.wf-turn' : sheet.selector);
    const box = spriteBox(sheet);
    assert.ok(line, sheet.name);
    for (const [key, value] of Object.entries(box)) assert.ok(line.includes(`${key}:${value};`), `${sheet.name} ${key} ${value}`);
    assert.ok(line.includes(`url('../assets/ui-sprites/ui-hud-${sheet.name}.png')`));
  }
  assert.ok(rule('.wf-turn[data-turn-side="theirs"]').includes("url('../assets/ui-sprites/ui-hud-turn-theirs.png')"));
  assert.ok(css.includes('.r2-wireframe-view .wf-sprite { display:none; }'), 'hidden outside the sprite mode');
  assert.ok(css.includes('background-size:400% 100%; image-rendering:pixelated;'));
  for (const position of ['33.333% 0', '66.667% 0', '100% 0']) assert.ok(css.includes(`background-position:${position};`), position);
  assert.match(css, /@media \(hover:hover\) \{\n.*:hover:not\(:disabled\) \.wf-sprite \{ background-position:33\.333% 0; \}/, 'hover only where a pointer hovers');
  assert.ok(css.includes('[data-count-peek] .r2-wireframe-view .wf-hud-sprites .wf-information .wf-sprite'), 'a held info button is pressed');
  assert.ok(!/animation|@keyframes/.test(css), 'still images only, no sway');
  assert.ok((await readSource('../src/main.js')).includes("import './ui-refresh/hud-sprites.css';"));
});

test('hud sprites: every HUD button carries one hidden sprite layer; the controls keep the class across patches', () => {
  const model = { match: { activeSeat: 'a', viewerSeat: 'a', progress: 'open', turnNumber: 1 }, requiredInput: null, globalActionIds: [], legalActions: [],
    seats: [{ seatId: 'a', turnsTaken: 1, memory: { current: 3, max: 5 }, hand: { count: 0 } }, { seatId: 'b', turnsTaken: 0, memory: { current: 0, max: 0 }, hand: { count: 4 } }] };
  const html = wireframeControlsHtml(model);
  assert.equal(html.split('<i class="wf-sprite" aria-hidden="true"></i>').length - 1, 4);
  assert.ok(html.includes('data-patch-keep="class:wf-hud-rendered class:wf-hud-sprites"'));
});

test('hud sprites: decoding all sheets is all-or-nothing; without Image it reads as unavailable', async () => {
  assert.equal(await loadHudSprites(async () => true), true);
  assert.equal(await loadHudSprites(async url => !url.includes('zones')), false);
  assert.equal(await loadHudSprites(), false, 'no Image in node: the CSS hexes stay');
});

const scenesRoot = () => {
  const classes = new Set();
  const controls = { classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); return on; } } };
  return { classes, root: { querySelector: selector => selector === '.wf-turn-controls' ? controls : null, querySelectorAll: () => [] } };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('hud sprites: the surface uses them in compat only, once loaded, and drops them for full', async () => {
  const { classes, root } = scenesRoot();
  let asked = 0;
  const scenes = createSurfaceScenes({ root, boardStyle: 'classic', renderQuality: { scale: 1 }, latest: () => null, lowGpu: true, loadSprites: async () => { asked++; return true; } });
  assert.equal(classes.has('wf-hud-sprites'), false, 'not before the sheets load');
  scenes.setLowGpu(false); scenes.setLowGpu(true); await tick();
  assert.equal(asked, 1, 'loaded once');
  assert.equal(classes.has('wf-hud-sprites'), true);
  scenes.setLowGpu(false);
  assert.equal(classes.has('wf-hud-sprites'), false, 'full draws the WebGL HUD instead');
  scenes.dispose();
});

test('hud sprites: a failed load keeps the CSS hexes; full never loads them', async () => {
  const failed = scenesRoot();
  const scenes = createSurfaceScenes({ root: failed.root, boardStyle: 'classic', renderQuality: { scale: 1 }, latest: () => null, lowGpu: false, loadSprites: async () => false });
  scenes.setLowGpu(true); await tick();
  assert.equal(failed.classes.has('wf-hud-sprites'), false);
  scenes.dispose();
  let asked = 0;
  const full = scenesRoot();
  const fullScenes = createSurfaceScenes({ root: full.root, boardStyle: 'classic', renderQuality: { scale: 1 }, latest: () => null, lowGpu: false, loadSprites: async () => { asked++; return true; } });
  fullScenes.setLowGpu(false); await tick();
  assert.equal(asked, 0);
  fullScenes.dispose();
});

test('hud sprites: Vite keeps them as hashed files, not data URLs', async () => {
  const config = await readSource('../vite.config.js');
  assert.ok(config.includes('assetsInlineLimit: file => /[\\\\/]assets[\\\\/]ui-sprites[\\\\/]/.test(file) ? false : undefined,'));
});
