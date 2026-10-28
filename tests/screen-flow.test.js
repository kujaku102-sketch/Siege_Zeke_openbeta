import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXTERNAL_LINKS, externalHref, runtimeTarget, titleLinks } from '../src/config/external-links.js';
import { runtimeShellHtml, titleLinksHtml } from '../src/ui-refresh/runtime-shell-view.js';
import { SCREENS, nextScreen, escapeScreen, isFlowScreen } from '../src/ui-refresh/screen-flow.js';
import { TUTORIAL_ITEMS, TUTORIAL_IDS, TUTORIAL_DONE_KEY, TUTORIAL_ORDER, numberTutorialItems, readTutorialDone, markTutorialDone } from '../src/ui-refresh/tutorial-items.js';
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

test('tutorial items: chapter numbers follow the color order with no gaps, renumbering when a tutorial joins', () => {
  assert.deepEqual([...TUTORIAL_ORDER], ['basics', 'blue', 'green', 'yellow', 'vengeance', 'black', 'orange']);
  const titles = ids => numberTutorialItems(ids.map(id => ({ id, subtitle: id, summary: id }))).map(item => `${item.id}=${item.title}`);
  assert.deepEqual(titles(['vengeance', 'basics']), ['basics=チャプター1', 'vengeance=チャプター2'], 'today: red 1, purple 2, whatever order they are given in');
  assert.deepEqual(titles(['basics', 'vengeance', 'blue']), ['basics=チャプター1', 'blue=チャプター2', 'vengeance=チャプター3']);
  assert.deepEqual(titles(['basics', 'blue', 'vengeance', 'green', 'yellow']),
    ['basics=チャプター1', 'blue=チャプター2', 'green=チャプター3', 'yellow=チャプター4', 'vengeance=チャプター5']);
  assert.deepEqual(titles(['orange', 'vengeance']), ['vengeance=チャプター1', 'orange=チャプター2'], 'no gaps for colors not yet made');
  const all = titles([...TUTORIAL_ORDER].reverse());
  assert.deepEqual(all.map(entry => entry.split('=')[1]), TUTORIAL_ORDER.map((_, index) => `チャプター${index + 1}`));
});

test('tutorial items: the three tutorials in list order (案A: red 1, blue 2, purple 3), each a real tutorial id with its own steps', () => {
  assert.deepEqual([...TUTORIAL_IDS], ['basics', 'blue', 'vengeance'], 'the ids stay the tutorial ids, so saved marks keep matching');
  assert.deepEqual(TUTORIAL_ITEMS.map(item => [item.title, item.subtitle]),
    [['チャプター1', '基本操作・赤'], ['チャプター2', 'ハッキング・暗号化・青'], ['チャプター3', 'ヴェンジェンス・紫']]);
  assert.equal(new Set(TUTORIAL_IDS).size, TUTORIAL_IDS.length, 'no duplicates');
  assert.notEqual(tutorialSteps('vengeance'), tutorialSteps('basics'), 'vengeance is not the fallback');
  assert.notEqual(tutorialSteps('blue'), tutorialSteps('basics'), 'blue is not the fallback');
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
  assert.equal((html.match(/未完了/g) ?? []).length, 2);
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
  assert.ok(html.includes('<h2>チャプター1<small>基本操作・赤</small></h2>') && html.includes('<h2>チャプター2<small>ハッキング・暗号化・青</small></h2>')
    && html.includes('<h2>チャプター3<small>ヴェンジェンス・紫</small></h2>'));
  assert.ok(html.indexOf('data-tutorial-item="basics"') < html.indexOf('data-tutorial-item="blue"') && html.indexOf('data-tutorial-item="blue"') < html.indexOf('data-tutorial-item="vengeance"'), 'listed in chapter order');
  assert.ok(html.includes('data-tutorial-item="basics" data-done="true"') && html.includes('data-tutorial-item="vengeance" data-done="false"'));
  assert.ok(html.includes('aria-label="チャプター1をはじめる"'));
});

test('the in-match tutorial select lists the chapters as the tutorial list does, the current one selected', () => {
  const html = runtimeShellHtml({ screen: 'game', mode: 'tutorial', tutorialId: 'blue', view: 'pc', options: true, savedDecks: [], deckBuilder: { open: false }, catalog: {} });
  const select = html.match(/<select data-tutorial-select[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(match => [match[1], match[2]]),
    [['basics', 'チャプター1 基本操作・赤'], ['blue', 'チャプター2 ハッキング・暗号化・青'], ['vengeance', 'チャプター3 ヴェンジェンス・紫']]);
  assert.match(select, /<option value="blue" selected>/);
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
  assert.ok(layout.includes("button:focus.button === 'play' ? `.r2-popup[data-card-id=\"${focus.cardId}\"] :is([data-route=\"executeCard\"],[data-route=\"executeSpell\"])` : null,"));
  assert.ok(layout.includes("route:focus.routes ? `.r2-popup[data-card-id=\"${focus.cardId}\"] :is(${focus.routes.map(route => `[data-route=\"${route}\"]`).join(',')})` : null,"), 'the popup button the step expects (文豪, 2026-10-28)');
  assert.ok(layout.includes("option:`[data-option-card-id=\"${focus.cardId}\"]`};"), 'a choice\'s option by the card it stands for');
  assert.ok(layout.includes("const expectedButton = expect => expect?.type === 'answerChoice' && expect.cardId ? [{ kind: 'option', cardId: expect.cardId }]"),
    'a step that asks for an answer points at its card\'s option (blue: the access pick of the Offense Protocol)');
  assert.ok(layout.includes("clearOfPortrait(guide, pointed.find(element => element.matches('.r2-detail [data-ability-help]')), viewport);"),
    'a badge in the detail at the left edge is scrolled clear of the portrait');
  assert.ok(layout.includes('for (const focus of [...tutorial.value.presentation.focus ?? [], ...expectedButton(tutorial.value.presentation.expect)])'), 'pointed at with the step\'s own highlights, so the band keeps clear of it');
  assert.ok(layout.includes('const named = element => !focus.badge ||'), 'a badge focus keeps only the named ability');
});

test('tutorial try: the blocked play moves the step on and puts its reason in the guide for that step; notices clear once the guide moves past them', async () => {
  const clicks = await readSource('../src/ui-refresh/surface-clicks.js');
  assert.ok(clicks.includes("['data-tutorial-try', (c, target) => { const next = c.session.advanceTutorial(); if (!next.ok) return c.onError(next.error.code); c.noteTutorial(blockMessage({ code: target.dataset.tutorialTry })); return c.act(c.ui.read()); }],"));
  const surfaceNote = await readSource('../src/ui-refresh/runtime-match-surface.js');
  assert.ok(surfaceNote.includes('const note = tutorialNote?.index === tutorial.value.flow.index ? { note: tutorialNote.text } : {};'), 'the note belongs to one step');
  const layout = await readSource('../src/ui-refresh/surface-layout.js');
  assert.ok(layout.includes("for (const element of root.querySelectorAll('.live-focus')) { element.classList.remove('live-focus'); delete element.dataset.tutorialFocusLabel; }"), 'last step\'s marks are cleared');
  assert.ok(layout.includes("if (focus.kind === 'ui' && focus.target === 'ability-badge' && scrolledFocus !== key) { scrolledFocus = key; element.scrollIntoView({ block: 'center', inline: 'nearest' }); }"), 'a highlighted badge is scrolled to the middle of its panel once, its outline clear of the edge');
  const surface = await readSource('../src/ui-refresh/runtime-match-surface.js');
  assert.ok(surface.includes('const reportError = code => { noticeStep = tutorialIndex(); onError(code); };'));
  assert.ok(surface.includes('if (noticeStep !== null && tutorial.ok && tutorial.value.flow.index > noticeStep) { noticeStep = null; onNoticeClear(); }'));
  assert.ok(surface.includes('onMenu, onError: reportError, noteTutorial, turnGuidePage, tapGuide };'), 'presses in the match are recorded');
  const main = await readSource('../src/main.js');
  assert.ok(main.includes("onNoticeClear:() => {if (host.notice) {host.notice = '';renderShell();}}"));
});

test('guide pages: one per 「」, each growing the frame as it needs on this screen; turned by buttons and arrows; earlier pages lock the match and hide highlights', async () => {
  const surface = await readSource('../src/ui-refresh/runtime-match-surface.js');
  assert.ok(surface.includes("guidePaging = { key, pages: splitGuidePages(presentation.text).map(page => ({ ...page, grow: Math.max(0, counter.frameHeight(page.text) - base) })) };"));
  assert.ok(surface.includes("const key = `${presentation.text}\\u0000${counter.width}\\u0000${viewport.height}\\u0000${fontEpoch}`;"), 'measured again when the screen or the fonts change');
  assert.ok(surface.includes('return pages ? { page: pages[guidePageShown.index]?.grow ?? 0, step: Math.max(0, ...pages.map(page => page.grow ?? 0)) } : { page: 0, step: 0 };'), 'the page shown, and the step\'s tallest page');
  assert.ok(surface.includes("for (const name of ['board', 'console', 'hand', 'hand-toggle', 'popup', 'selection', 'detail', 'drawer']) { const host = root.querySelector(`[data-live-region=\"${name}\"]`); if (host) host.inert = reading; }"));
  assert.ok(surface.includes("if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && event.target.closest?.('.live-guide')) {"));
  assert.ok(surface.includes("if (focused) (root.querySelector(delta < 0 && index > 0 ? '.live-guide [data-runtime-guide-prev]' : forward) ?? root.querySelector(forward))?.focus();"), 'focus follows the button pressed, [次へ] on the next page');
  const layout = await readSource('../src/ui-refresh/surface-layout.js');
  assert.ok(layout.includes('if (tutorial.ok && !tutorial.value.flow.complete) for (const focus of'));
  assert.ok(layout.includes("pointed.push(element);\n        if (!guideLastPage()) continue;\n        element.classList.add('live-focus');"), 'found on every page, marked on the last');
  const clicks = await readSource('../src/ui-refresh/surface-clicks.js');
  assert.ok(clicks.includes("['data-runtime-guide-next', c => c.turnGuidePage(1)],") && clicks.includes("['data-runtime-guide-prev', c => c.turnGuidePage(-1)],"));
});

test('guide band: the guide fills one of three bands, chosen once a step against what it points at; compat mode marked for the skin', async () => {
  const layout = await readSource('../src/ui-refresh/surface-layout.js');
  assert.ok(layout.includes("const key = `${guideStep()}|${viewport.width}x${viewport.height}|${rects.length}|${Math.round(grow.step)}`;"), 'kept while the pages turn');
  assert.ok(layout.includes('if (guideBand.key !== key) guideBand = { key, band: chooseGuideBand(viewport, rects, tutorial.ok ? tutorial.value.presentation.band : null, { aspect: GUIDE_PORTRAIT_ASPECT, grow: grow.step }) };'), 'judged by the group: the portrait and the frame, as tall as the step\'s tallest page');
  assert.ok(layout.includes("applyGuideBand(view, guideBand.band, viewport, grow.page);\n      clearOfPortrait(guide, pointed.find(element => element.matches('.r2-detail [data-ability-help]')), viewport);\n      paginateGuide(guide);"), 'pages are measured in the band as placed');
  assert.ok(layout.includes("const picks = [...root.querySelectorAll('.request-target,.runtime-selection-option,[data-runtime-confirm],[data-runtime-back],[data-runtime-decline]')];"), "a pick's options count as covered");
  const guide = await readSource('../src/ui-refresh/guide.js');
  assert.ok(guide.includes('view.dataset.guideBand = band;'));
  assert.ok(guide.includes('const { frame, portrait, box } = guideLayout(band, viewport, GUIDE_PORTRAIT_ASPECT, grow);'), 'placed as the group: frame and portrait together');
  const css = await readSource('../src/ui-refresh/live.css');
  assert.ok(!css.includes('[data-guide-band="top"] .r2-guide.live-guide .live-guide-cast'), 'the portrait stands on the frame in every band');
  assert.ok(css.includes('.live-guide[data-paging="pending"] .live-guide-text { overflow:hidden; }') && !/data-paging="pending"\][^{]*\{[^}]*visibility:hidden/.test(css), 'the line shows while the pages are cut');
  assert.ok(guide.includes('frameHeight(value) { return Math.ceil(chrome + (count(value) + 1) * lineHeight); },'), "one line kept for a refused move's reason");
  // PC (文豪, 2026-10-28): the buttons in one row on the speaker-name line, the text across the frame; phones keep the column.
  assert.ok(css.includes('body[data-view="pc"] .r2-content .r2-guide.live-guide .live-guide-speech { grid-template-columns:minmax(0,1fr); }'));
  assert.ok(css.includes('body[data-view="pc"] .r2-content .r2-guide.live-guide nav { position:absolute; top:.3em; right:.45em; grid-column:1;'), 'on the name line, top right: no line of the frame for them; placed in the frame\'s one column, not a zero-width second');
  assert.ok(css.includes('grid-template-areas:"page skip turn"; gap:0 .6em; margin:0; }'), 'one row');
  assert.ok(!/body\[data-view="pc"\][^{]*\{[^}]*\d+px/.test(css), 'sized as ratios, no px');
  const surface = await readSource('../src/ui-refresh/runtime-match-surface.js');
  assert.ok(surface.includes("root.querySelector('.r2-runtime-view')?.classList.toggle('live-low-gpu', lowGpu);"));
  const view = await readSource('../src/ui-refresh/runtime-read-view.js');
  assert.ok(view.includes('<span class="live-guide-noportrait" aria-hidden="true">'), 'a speaker with no portrait');
});
