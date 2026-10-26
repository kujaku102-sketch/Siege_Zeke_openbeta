import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXTERNAL_LINKS, externalHref, runtimeTarget, titleLinks } from '../src/config/external-links.js';
import { runtimeShellHtml, titleLinksHtml } from '../src/ui-refresh/runtime-shell-view.js';
import { SCREENS, nextScreen, escapeScreen, isFlowScreen } from '../src/ui-refresh/screen-flow.js';
import { TUTORIAL_ITEMS, TUTORIAL_IDS, TUTORIAL_DONE_KEY, readTutorialDone, markTutorialDone } from '../src/ui-refresh/tutorial-items.js';
import { battleSetupHtml, tutorialSelectHtml } from '../src/ui-refresh/flow-screens-view.js';
import { deckOptionsHtml, userOptionsHtml } from '../src/ui-refresh/runtime-shell-view.js';
import { START_DECKS } from '../src/data/start-decks.js';
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
  assert.deepEqual([...TUTORIAL_IDS], ['basics', 'vengeance'], 'the ids stay the tutorial ids, so saved marks keep matching');
  assert.deepEqual(TUTORIAL_ITEMS.map(item => [item.title, item.subtitle]), [['チャプター1', '基本操作・赤'], ['チャプター2', 'ヴェンジェンス・紫']]);
  assert.equal(new Set(TUTORIAL_IDS).size, TUTORIAL_IDS.length, 'no duplicates');
  assert.notEqual(tutorialSteps('vengeance'), tutorialSteps('basics'), 'vengeance is not the fallback');
  for (const item of TUTORIAL_ITEMS) {
    assert.ok(tutorialSteps(item.id).length > 1, item.id);
    assert.ok(item.title && item.subtitle && item.summary, item.id);
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

test('battle setup: deck and user for both sides, start, deck building, and a 準備中 online button', () => {
  const host = entryHost({ screen: 'battle-setup', playerDeckId: 'start-blue', aiDeckId: 'start-yellow', playerUserId: 'phoenix', aiUserId: 'bigboss' });
  const html = battleSetupHtml(host, { deckOptions: selected => deckOptionsHtml({ savedDecks: [] }, selected), userOptions: userOptionsHtml });
  for (const attr of ['data-player-deck', 'data-player-user', 'data-ai-deck', 'data-ai-user']) assert.ok(html.includes('<select ' + attr + '>'), attr);
  assert.ok(html.includes('<option value="start-blue" selected>') && html.includes('<option value="start-yellow" selected>'));
  assert.ok(html.includes('<option value="phoenix" selected>') && html.includes('<option value="bigboss" selected>'));
  const playerDecks = html.slice(html.indexOf('<select data-player-deck>'), html.indexOf('</select>', html.indexOf('<select data-player-deck>')));
  assert.equal(playerDecks.split('<option').length - 1, START_DECKS.length, 'the seven start decks');
  assert.ok(html.includes('対戦相手：CPU') && !/強さ|難易度/.test(html), 'one CPU, no strength choice');
  for (const deck of START_DECKS) assert.ok(!html.includes(deck.tactic), 'no tactic memo: ' + deck.id);
  assert.ok(html.includes('data-start="ai"') && html.includes('data-deck-open') && html.includes('data-flow-back'));
  assert.ok(html.includes('<button class="r2-flow-online" data-online-battle aria-disabled="true">オンライン対戦<small>準備中</small></button>'));
  assert.ok(!html.includes('data-mode='), 'starting is not a title route');
});

test('battle setup: saved decks are offered, one that needs fixing cannot be picked; the shell draws it', () => {
  const broken = { id: 'bad', name: 'BAD', userId: 'doors_zx', cards: {} };
  const shell = runtimeShellHtml(entryHost({ screen: 'battle-setup', savedDecks: [broken] }));
  assert.ok(shell.includes('data-flow-screen="battle-setup"') && !shell.includes('r2-mode-grid'));
  assert.match(shell, /<option value="custom:bad"\s+disabled>保存: BAD（要修正）<\/option>/, 'a deck that needs fixing is disabled');
  assert.ok(!runtimeShellHtml(entryHost({ screen: 'entry' })).includes('data-flow-screen'), 'the title draws no flow screen');
});

test('title: the tutorial and battle buttons open their screens; the battle button reads 対戦; sandbox still starts', () => {
  const title = runtimeShellHtml(entryHost());
  assert.ok(title.includes('<button data-mode="tutorial" data-flow="open-tutorials">'));
  assert.ok(title.includes('<button data-mode="ai" data-flow="open-battle">'));
  assert.ok(title.includes('<strong>対戦</strong>') && !title.includes('AI対戦'));
  assert.ok(title.includes('<button data-mode="sandbox">'), 'the sandbox has no flow screen');
});

test('main wiring: flow buttons before title modes, Escape and [戻る] through the table, no browser history', async () => {
  const main = await readSource('../src/main.js');
  const click = main.slice(main.indexOf("root.addEventListener('click'"));
  assert.ok(click.indexOf('if (d.flow) return goTo(nextScreen(host.screen,d.flow));') < click.indexOf('if (d.mode) return startMatch(d.mode);'), 'data-flow wins over data-mode');
  assert.ok(click.includes("if (button.hasAttribute('data-flow-back')) return goTo(nextScreen(host.screen,'back'));"));
  assert.ok(click.includes("if (d.start) return startMatch(d.start,d.start === 'tutorial' ? d.tutorialId : host.tutorialId);"));
  assert.ok(click.includes("if (button.hasAttribute('data-online-battle')) return onOnlineBattle();"));
  assert.ok(main.includes('function onOnlineBattle() {}'), 'online play is not connected');
  assert.ok(main.includes('const back = escapeScreen(host.screen,{overlayOpen:host.options || host.deckBuilder.open || host.catalogOpen});'));
  for (const source of [main, await readSource('../src/ui-refresh/screen-flow.js'), await readSource('../src/ui-refresh/runtime-shell-view.js')])
    assert.ok(!/pushState|replaceState|popstate|location\.hash/.test(source), 'no history API (Q14)');
});

test('main wiring: a won tutorial is marked on its way out and its button returns to the list; a skipped one goes to the sandbox unfinished', async () => {
  const main = await readSource('../src/main.js');
  const replace = main.slice(main.indexOf('function replaceTutorial(complete) {'), main.indexOf('const tutorialWon'));
  assert.ok(replace.includes("if (complete) return leaveMatch(nextScreen('game','tutorial-complete'));"));
  assert.ok(replace.includes('lifecycle.skipTutorial()') && replace.includes("host.mode = 'sandbox'"));
  assert.ok(!replace.includes('markTutorialDone'), 'skipping marks nothing');
  assert.ok(main.includes("const tutorialWon = () => host.mode === 'tutorial' && session?.tutorial?.().value?.flow?.complete === true;"));
  assert.ok(main.includes("function leaveMatch(screen = nextScreen('game','leave')) {if (tutorialWon()) host.tutorialDone = markTutorialDone(globalThis.localStorage,host.tutorialId);lifecycle.leave();"),
    'marked before the match is left, whichever way out');
  assert.ok(main.includes('tutorialDone:readTutorialDone(globalThis.localStorage)'));
  const surface = await readSource('../src/ui-refresh/runtime-match-surface.js');
  assert.ok(!surface.includes('flow.complete && latest.model.requiredInput === null) schedule('), 'no automatic exit: the closing line stays until its button');
});

test('tutorial list: chapters with their old names as subtitles; a mark saved under the old ids still shows', () => {
  const storage = { getItem: () => '["basics"]', setItem() {} };
  const html = tutorialSelectHtml({ tutorialDone: readTutorialDone(storage) });
  assert.ok(html.includes('<h2>チャプター1<small>基本操作・赤</small></h2>') && html.includes('<h2>チャプター2<small>ヴェンジェンス・紫</small></h2>'));
  assert.ok(html.includes('data-tutorial-item="basics" data-done="true"') && html.includes('data-tutorial-item="vengeance" data-done="false"'));
  assert.ok(html.includes('aria-label="チャプター1をはじめる"'));
});

test('Escape is taken on the document, so it works with the focus on <body> after the options open or the deck builder closes', async () => {
  const main = await readSource('../src/main.js');
  assert.ok(main.includes("document.addEventListener('keydown',event => {if (event.key === 'Escape' && !event.target.closest?.('[data-match-root]')) {"));
  assert.ok(!main.includes("root.addEventListener('keydown'"), 'not only inside #app');
});

test('the menu over the flow screens meets the 44 CSS px tap floor in relative units', async () => {
  const css = await readSource('../src/ui-refresh/flow-screens.css');
  assert.ok(css.includes('.r2-content:has(.r2-flow) .r2-utilities button { min-width:2.75rem; min-height:2.75rem;'));
});

test('tutorial highlights: HUD info button, the focused card\'s detail and its ability button, and the play route in its popup', async () => {
  const layout = await readSource('../src/ui-refresh/surface-layout.js');
  assert.ok(layout.includes("ui:{'info-button':'[data-runtime-counts]','card-detail':`.r2-detail[data-card-id=\"${focus.cardId}\"]`,"));
  assert.ok(layout.includes("'ability-badge':`.r2-detail[data-card-id=\"${focus.cardId}\"] [data-ability-help]`}[focus.target],"));
  assert.ok(layout.includes("button:focus.button === 'play' ? `.r2-popup[data-card-id=\"${focus.cardId}\"] :is([data-route=\"executeCard\"],[data-route=\"executeSpell\"])` : null};"));
  assert.ok(layout.includes('const named = element => !focus.badge ||'), 'a badge focus keeps only the named ability');
});

test('tutorial try: the blocked play moves the step on, then names the reason; the notice clears once the guide moves past it', async () => {
  const clicks = await readSource('../src/ui-refresh/surface-clicks.js');
  assert.ok(clicks.includes("['data-tutorial-try', (c, target) => { const next = c.session.advanceTutorial(); if (!next.ok) return c.onError(next.error.code); c.act(c.ui.read()); return c.onError(target.dataset.tutorialTry); }],"));
  const surface = await readSource('../src/ui-refresh/runtime-match-surface.js');
  assert.ok(surface.includes('const reportError = code => { noticeStep = tutorialIndex(); onError(code); };'));
  assert.ok(surface.includes('if (noticeStep !== null && tutorial.ok && tutorial.value.flow.index > noticeStep) { noticeStep = null; onNoticeClear(); }'));
  assert.ok(surface.includes('onMenu, onError: reportError };'), 'presses in the match are recorded');
  const main = await readSource('../src/main.js');
  assert.ok(main.includes("onNoticeClear:() => {if (host.notice) {host.notice = '';renderShell();}}"));
});
