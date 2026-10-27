import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_PAGE_MARK, splitGuidePages } from '../src/ui-refresh/guide-pages.js';
import { createTutorialFlow, currentTutorialStep } from '../src/data/tutorial-script.js';

const texts = pages => pages.map(page => page.text);
const reasons = pages => pages.map(page => page.reason);
const a = n => 'あ'.repeat(n);

// Every line of both tutorials, in order.
const scriptLines = () => ['basics', 'vengeance'].flatMap(id => {
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

test('guide pages: the script — 7 marks in 6 lines; the longest 「」 (81, 75, 72, 65, 58 characters) are one page each', () => {
  const lines = scriptLines();
  assert.deepEqual([lines.filter(line => line.text.includes(GUIDE_PAGE_MARK)).length, lines.reduce((sum, line) => sum + line.text.split(GUIDE_PAGE_MARK).length - 1, 0)], [6, 7]);
  const pages = lines.flatMap(line => splitGuidePages(line.text).map(page => ({ at: line.at, length: [...page.text].length })));
  assert.equal(pages.length, lines.length + 7, 'a page per line, and one more at each mark');
  assert.deepEqual(pages.map(page => page.length).sort((x, y) => y - x).slice(0, 5), [81, 75, 72, 65, 58]);
  for (const line of lines) assert.equal(texts(splitGuidePages(line.text)).join(''), line.text.replaceAll(GUIDE_PAGE_MARK, ''), `${line.at}: nothing lost or added`);
});
