import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Shapes kept on every screen (文豪, 2026-10-27). On iOS Safari `vh` is the height with the toolbar hidden: with the
// toolbar shown, anything sized by it is taller than the screen, and a page with `min-height:100vh` scrolls, moving
// in-flow content against fixed controls (the title's buttons left the title's corner). The UI sizes by `dvh`.
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cssFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []);
const css = file => readFileSync(join(root, file), 'utf8');

test('aspect: no plain vh in the UI styles — the visible height (dvh) or the small one (svh) only', () => {
  const found = [];
  for (const file of cssFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/(\d*\.?\d+)vh\b/g)) if (!/[dsl]$/.test(text.slice(0, m.index))) found.push(`${file.slice(root.length)}: ${text.slice(Math.max(0, m.index - 30), m.index + 6).replace(/\s+/g, ' ')}`);
  }
  assert.deepEqual(found, []);
});

test('aspect: the page never grows past the screen; boxes sized from two bases keep their ratio', () => {
  assert.match(css('src/styles.css'), /body \{ margin: 0; min-width: 0; min-height: 100dvh;/, 'the body fills the visible height, no more');
  assert.match(css('src/styles.css'), /--log-h:76dvh; width:min\(92vw,calc\(var\(--log-h\) \* 4 \/ 3\)\); height:auto; aspect-ratio:4 \/ 3;/, 'the battle log is 4:3 at any width or height');
  assert.match(css('src/ui-refresh/entry-design.css'), /\.r2-entry-crt-menu>section \{ width:min\(75vw,105dvh\); height:auto; aspect-ratio:7 \/ 5;/, 'the CRT menu keeps the title\'s 7:5');
  assert.match(css('src/ui-refresh/entry-design.css'), /\.r2-content \.r2-entry \{[^}]*width:min\(100%,140dvh\); height:auto; aspect-ratio:7\/5;/, 'the title box is 7:5');
});
