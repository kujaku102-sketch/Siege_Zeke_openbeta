import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_MAX_LINES, GUIDE_PAGE_MARK, splitGuidePages } from '../src/ui-refresh/guide-pages.js';

// A screen with `perLine` characters a line (the DOM measures this in the app).
const lines = perLine => text => Math.max(1, Math.ceil([...text].length / perLine));
const texts = pages => pages.map(page => page.text);
const reasons = pages => pages.map(page => page.reason);
const a = n => 'あ'.repeat(n), i = n => 'い'.repeat(n);

test('guide pages: three lines by default, one mark (▽) in one place', () => {
  assert.equal(GUIDE_MAX_LINES, 3);
  assert.equal(GUIDE_PAGE_MARK, '▽');
});

test('guide pages: ▽ splits where the author put it and never shows', () => {
  const pages = splitGuidePages('では、まず出してみましょう。▽ これがObです。▽', { lineCount: lines(40) });
  assert.deepEqual(texts(pages), ['では、まず出してみましょう。', 'これがObです。']);
  assert.deepEqual(reasons(pages), ['mark', 'end']);
  assert.ok(pages.every(page => !page.text.includes('▽')));
  assert.deepEqual(texts(splitGuidePages('▽▽ ', { lineCount: lines(40) })), [''], 'nothing to say is one empty page');
});

test('guide pages: a line that fits stays one page; the boundary is the third line', () => {
  assert.deepEqual(texts(splitGuidePages(a(30), { lineCount: lines(10) })), [a(30)], 'exactly three lines');
  const over = splitGuidePages(a(31), { lineCount: lines(10) });
  assert.equal(over.length, 2, 'one character into the fourth line makes a second page');
  assert.deepEqual(splitGuidePages(a(31), { lineCount: lines(10), maxLines: 4 }).length, 1, 'the limit is one constant');
  assert.deepEqual(texts(splitGuidePages(a(200))), [a(200)], 'without a measure nothing is split automatically');
});

test('guide pages: an overlong page is cut after the last sentence end that fits', () => {
  const pages = splitGuidePages(`${a(12)}。${a(8)}！${i(15)}`, { lineCount: lines(10) });
  assert.deepEqual(texts(pages), [`${a(12)}。${a(8)}！`, i(15)]);
  assert.equal(pages[0].reason, 'sentence');
  // A closing bracket right after the sentence end stays with it.
  const quoted = splitGuidePages(`${a(18)}。」${i(15)}`, { lineCount: lines(10) });
  assert.deepEqual(texts(quoted), [`${a(18)}。」`, i(15)]);
  // …… is one mark: the cut never falls between its dots.
  const dots = splitGuidePages(`${a(27)}……${i(10)}`, { lineCount: lines(10) });
  assert.ok(!dots[1].text.startsWith('…'), JSON.stringify(texts(dots)));
});

test('guide pages: with no sentence end it cuts after a comma, then by length, never starting a page with 。 or 」', () => {
  const comma = splitGuidePages(`${a(22)}、${i(15)}`, { lineCount: lines(10) });
  assert.deepEqual(texts(comma), [`${a(22)}、`, i(15)]);
  assert.equal(comma[0].reason, 'comma');
  const length = splitGuidePages(a(45), { lineCount: lines(10) });
  assert.deepEqual(texts(length), [a(30), a(15)]);
  assert.equal(length[0].reason, 'length');
  // The 31st character is 。: cutting at 30 would start the next page with it, so the cut moves back.
  const kinsoku = splitGuidePages(`${a(30)}。${i(5)}`, { lineCount: lines(10) });
  assert.deepEqual(texts(kinsoku), [a(29), `あ。${i(5)}`]);
  assert.equal(kinsoku[0].reason, 'kinsoku');
  for (const page of [...comma, ...length, ...kinsoku].slice(1)) assert.ok(!/^[。、」』）！？]/.test(page.text), page.text);
});

test('guide pages: marks come first, the automatic cut only fills in a piece that is still too long', () => {
  const pages = splitGuidePages(`短い前置き。▽${a(20)}。${i(20)}。`, { lineCount: lines(10) });
  assert.deepEqual(texts(pages), ['短い前置き。', `${a(20)}。`, `${i(20)}。`]);
  assert.deepEqual(reasons(pages), ['mark', 'sentence', 'end']);
});

test('guide pages: the red script\'s longest line (210 chars) splits only where a narrow screen needs it', () => {
  const longest = 'ターンの開始時には1枚ドロー！スリープしていたObのスタンバイが行われ、アクティブメモリも上限まで回復します。そして、相手のエリアには『セキュリティ』を持ったObが配置されています。これがスリープしている間、攻撃対象はスリープしたObだけが可能になります。つまり、相手ユーザーへの攻撃が届きません。しかも、STRは4と高いです。ここでCodeを使ったパワーアップを説明します！手札にある『ジャンクパーツ』をご覧ください！';
  assert.equal(splitGuidePages(longest, { lineCount: lines(117) }).length, 1, 'PC: one page');
  const narrow = splitGuidePages(longest, { lineCount: lines(56) });
  assert.equal(narrow.length, 2, '640 wide: two pages');
  assert.ok(narrow.every(page => lines(56)(page.text) <= 3));
  assert.equal(narrow.map(page => page.text).join(''), longest, 'nothing lost or added');
  assert.equal(narrow[0].reason, 'sentence');
});
