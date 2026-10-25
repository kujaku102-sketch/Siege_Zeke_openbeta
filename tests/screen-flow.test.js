import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXTERNAL_LINKS, externalHref, runtimeTarget, titleLinks } from '../src/config/external-links.js';
import { runtimeShellHtml, titleLinksHtml } from '../src/ui-refresh/runtime-shell-view.js';
import { SCREENS, nextScreen, escapeScreen, isFlowScreen } from '../src/ui-refresh/screen-flow.js';
import { TUTORIAL_ITEMS, TUTORIAL_IDS, TUTORIAL_DONE_KEY, readTutorialDone, markTutorialDone } from '../src/ui-refresh/tutorial-items.js';
import { tutorialSelectHtml } from '../src/ui-refresh/flow-screens-view.js';
import { tutorialSteps } from '../src/data/tutorial-script.js';

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

test('screen flow: the title opens the tutorial list and the battle setup; each comes back or starts', () => {
  assert.deepEqual([...SCREENS], ['entry', 'tutorial-select', 'battle-setup', 'game']);
  assert.equal(nextScreen('entry', 'open-tutorials'), 'tutorial-select');
  assert.equal(nextScreen('entry', 'open-battle'), 'battle-setup');
  assert.equal(nextScreen('entry', 'start'), 'game', 'the sandbox still starts from the title');
  for (const screen of ['tutorial-select', 'battle-setup']) {
    assert.equal(nextScreen(screen, 'back'), 'entry');
    assert.equal(nextScreen(screen, 'start'), 'game');
  }
  assert.equal(nextScreen('game', 'leave'), 'entry');
  assert.equal(nextScreen('game', 'tutorial-complete'), 'tutorial-select');
});

test('screen flow: an event a screen does not take, or an unknown screen, moves nowhere', () => {
  for (const [screen, event] of [['entry', 'back'], ['entry', 'leave'], ['tutorial-select', 'open-battle'], ['battle-setup', 'open-tutorials'],
    ['game', 'back'], ['game', 'start'], ['tutorial-select', 'tutorial-complete'], ['online-room', 'back'], ['entry', 'constructor'], ['entry', 'toString'],
    ['__proto__', 'back'], [undefined, 'start'], ['entry', undefined]])
    assert.equal(nextScreen(screen, event), null, `${screen} / ${event}`);
});

test('screen flow: Escape goes back from a flow screen only with nothing open over it', () => {
  assert.equal(escapeScreen('tutorial-select'), 'entry');
  assert.equal(escapeScreen('battle-setup'), 'entry');
  assert.equal(escapeScreen('battle-setup', { overlayOpen: true }), null);
  assert.equal(escapeScreen('entry'), null);
  assert.equal(escapeScreen('game'), null);
  assert.deepEqual(SCREENS.filter(isFlowScreen), ['tutorial-select', 'battle-setup']);
});

const memoryStorage = (initial = {}, { failWrite = false, failRead = false } = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => { if (failRead) throw new Error('blocked'); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { if (failWrite) throw new Error('quota'); data.set(key, String(value)); } };
};

test('tutorial items: the two existing tutorials, each a real tutorial id with its own steps', () => {
  assert.deepEqual([...TUTORIAL_IDS], ['basics', 'vengeance']);
  assert.equal(new Set(TUTORIAL_IDS).size, TUTORIAL_IDS.length, 'no duplicates');
  assert.notEqual(tutorialSteps('vengeance'), tutorialSteps('basics'), 'vengeance is not the fallback');
  for (const item of TUTORIAL_ITEMS) {
    assert.ok(tutorialSteps(item.id).length > 1, item.id);
    assert.ok(item.title && item.color && item.summary, item.id);
    assert.ok(Object.isFrozen(item));
  }
});

test('tutorial progress: kept in this browser; broken, foreign or unreadable values read as unfinished', () => {
  assert.equal(TUTORIAL_DONE_KEY, 'sz-tutorial-done');
  assert.deepEqual(readTutorialDone(memoryStorage()), []);
  assert.deepEqual(readTutorialDone(null), []);
  for (const raw of ['{', '"basics"', '{"basics":true}', 'null', '42', '["lab","x"]'])
    assert.deepEqual(readTutorialDone(memoryStorage({ [TUTORIAL_DONE_KEY]: raw })), [], raw);
  assert.deepEqual(readTutorialDone(memoryStorage({ [TUTORIAL_DONE_KEY]: '["vengeance","nope","vengeance","basics"]' })), ['basics', 'vengeance']);
  assert.deepEqual(readTutorialDone(memoryStorage({}, { failRead: true })), []);
});

test('tutorial progress: marking is idempotent, ignores unknown ids, and a failed save leaves it unfinished', () => {
  const storage = memoryStorage();
  assert.deepEqual(markTutorialDone(storage, 'vengeance'), ['vengeance']);
  assert.deepEqual(markTutorialDone(storage, 'vengeance'), ['vengeance']);
  assert.deepEqual(markTutorialDone(storage, 'basics'), ['basics', 'vengeance']);
  assert.equal(storage.data.get(TUTORIAL_DONE_KEY), '["basics","vengeance"]');
  assert.deepEqual(markTutorialDone(storage, 'lab'), ['basics', 'vengeance']);
  assert.deepEqual(markTutorialDone(memoryStorage({}, { failWrite: true }), 'basics'), [], 'not saved = not finished');
});

test('tutorial list screen: each item, its mark and its own start; a way back; drawn by the shell', () => {
  const html = tutorialSelectHtml({ tutorialDone: ['vengeance'] });
  assert.ok(html.includes('data-flow-back') && html.includes('>戻る<'));
  assert.ok(html.includes('data-start="tutorial" data-tutorial-id="basics"') && html.includes('data-start="tutorial" data-tutorial-id="vengeance"'));
  assert.ok(html.includes('data-tutorial-item="basics" data-done="false"') && html.includes('data-tutorial-item="vengeance" data-done="true"'));
  assert.equal((html.match(/✓ 完了/g) ?? []).length, 1);
  assert.equal((html.match(/未完了/g) ?? []).length, 1);
  assert.ok(!html.includes('data-mode='), 'no title route is repeated on the list');
  const shell = runtimeShellHtml(entryHost({ screen: 'tutorial-select', tutorialDone: [] }));
  assert.ok(shell.includes('data-flow-screen="tutorial-select"'));
  assert.ok(!shell.includes('r2-mode-grid') && !shell.includes('r2-title-links'), 'the title is not drawn under it');
  assert.ok(runtimeShellHtml(entryHost({ screen: 'tutorial-select', options: true })).includes('r2-title-options'), 'the title options, not the match options');
});
