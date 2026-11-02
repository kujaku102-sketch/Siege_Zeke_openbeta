import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_PAGE_MARK, splitGuidePages } from '../src/ui-refresh/guide-pages.js';
import { createTutorialFlow, currentTutorialStep } from '../src/data/tutorial-script.js';

const texts = pages => pages.map(page => page.text);
const reasons = pages => pages.map(page => page.reason);
const a = n => 'あ'.repeat(n);

// Every line of every tutorial, in order.
const scriptLines = () => ['basics', 'vengeance', 'blue'].flatMap(id => {
  const flow = createTutorialFlow(id), lines = [];
  flow.introComplete = true;
  for (let index = 0; index < 100; index += 1) {
    flow.index = index;
    const step = currentTutorialStep(flow);
    if (!step || (lines.length && step === lines.at(-1).step)) break;
    lines.push({ at: `${id}:${index}`, step, text: step.text });
  }
  return lines;
});

test('guide pages: one mark (▽), and pages are cut there only — one 「」 of the script a page (文豪, 2026-10-28)', () => {
  assert.equal(GUIDE_PAGE_MARK, '▽');
  const pages = splitGuidePages('では、まず出してみましょう。▽ これがObです。▽');
  assert.deepEqual(texts(pages), ['では、まず出してみましょう。', 'これがObです。']);
  assert.deepEqual(reasons(pages), ['mark', 'end']);
  assert.ok(pages.every(page => !page.text.includes('▽')));
  assert.deepEqual(texts(splitGuidePages('▽▽ ')), [''], 'nothing to say is one empty page');
  assert.deepEqual(texts(splitGuidePages(`${a(200)}。${a(200)}、${a(200)}`)), [`${a(200)}。${a(200)}、${a(200)}`], 'never cut by length, sentence or comma');
});

test('guide pages: every line of the script is cut at its marks only, a page per line and one more at each mark, nothing lost or added', () => {
  const lines = scriptLines();
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const pages = splitGuidePages(line.text), marks = line.text.split(GUIDE_PAGE_MARK).length - 1;
    assert.ok(pages.length >= 1 && pages.length <= marks + 1, `${line.at}: at most a page per mark and one more`);
    assert.equal(texts(pages).join(''), line.text.replaceAll(GUIDE_PAGE_MARK, ''), `${line.at}: nothing lost or added`);
    assert.ok(pages.every(page => !page.text.includes(GUIDE_PAGE_MARK)), `${line.at}: no mark left in a page`);
  }
});
