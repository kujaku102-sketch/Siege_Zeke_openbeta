import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXTERNAL_LINKS, externalHref, runtimeTarget, titleLinks } from '../src/config/external-links.js';
import { runtimeShellHtml, titleLinksHtml } from '../src/ui-refresh/runtime-shell-view.js';

const readSource = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const entryHost = (extra = {}) => ({ screen: 'entry', mode: 'sandbox', tutorialId: 'basics', view: 'pc', savedDecks: [], deckBuilder: { open: false },
  catalog: {}, opponentControl: 'manual', playerDeckId: 'start-red', aiDeckId: 'start-yellow', playerUserId: 'doors_zx', aiUserId: 'doors_zx', ...extra });

test('external links: the addresses are not set yet, and only https counts as set', () => {
  assert.deepEqual({ ...EXTERNAL_LINKS }, { download: '', discord: '' }, 'no placeholder address is shipped');
  assert.ok(Object.isFrozen(EXTERNAL_LINKS));
  assert.equal(externalHref('https://example.test/client'), 'https://example.test/client');
  assert.equal(externalHref('  https://example.test/x  '), 'https://example.test/x');
  for (const value of ['', '   ', null, undefined, 42, 'http://example.test', 'javascript:alert(1)', 'ftp://x.test', '//example.test', 'example.test', 'https://'])
    assert.equal(externalHref(value), null, String(value));
});

test('external links: one place says where the page runs, and it is always the web for now', () => {
  assert.equal(runtimeTarget(), 'web');
  assert.deepEqual(titleLinks().map(link => [link.key, link.href]), [['download', null], ['discord', null]]);
  assert.deepEqual(titleLinks({ download: 'https://a.test/', discord: 'https://b.test/' }, 'desktop').map(link => link.key), ['discord'], 'the desktop client hides the download link');
});

test('external links: a link without an address is 準備中 and cannot be followed; a set one opens a new tab', () => {
  const pending = titleLinksHtml();
  assert.equal((pending.match(/準備中/g) ?? []).length, 2);
  assert.ok(!pending.includes('href='), 'no href while not set');
  assert.equal((pending.match(/aria-disabled="true"/g) ?? []).length, 2);
  const set = titleLinksHtml(titleLinks({ download: 'https://a.test/dl', discord: 'https://b.test/"x' }));
  assert.ok(set.includes('href="https://a.test/dl" target="_blank" rel="noopener noreferrer"'));
  assert.ok(set.includes('href="https://b.test/%22x"'), 'the address is normalised and escaped');
  assert.ok(!set.includes('準備中'));
});

test('external links: on the title only, outside the stage, and the CRT title keeps its four buttons', async () => {
  const title = runtimeShellHtml(entryHost());
  const stageEnd = title.indexOf('</section>');
  assert.ok(title.indexOf('class="r2-title-links"') > stageEnd, 'the links come after the 7:5 stage');
  assert.equal((title.match(/<nav class="r2-mode-grid"[\s\S]*?<\/nav>/)[0].match(/<button/g) ?? []).length, 4);
  assert.ok(!runtimeShellHtml(entryHost({ screen: 'game' })).includes('r2-title-links'));
  const crt = await readSource('../src/ui-refresh/entry-crt-viewport.js');
  assert.ok(crt.includes('buttons.length !== 4'), 'the CRT contract is unchanged');
  const css = await readSource('../src/ui-refresh/flow-screens.css');
  assert.ok(!/\d(?:\.\d+)?px/.test(css), 'the flow screens bring no px sizes');
  assert.ok((await readSource('../src/ui-refresh/live-entry.js')).includes('import "./flow-screens.css";'));
});
