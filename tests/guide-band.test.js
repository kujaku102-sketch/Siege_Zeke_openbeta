import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_BANDS, guideBandRect, chooseGuideBand } from '../src/ui-refresh/guide-band.js';

const screen = { width: 852, height: 393 };
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

test('guide band: three equal bands, bottom first, then top, then middle', () => {
  assert.deepEqual([...GUIDE_BANDS], ['bottom', 'top', 'middle']);
  assert.deepEqual(guideBandRect('top', screen), { left: 0, top: 0, right: 852, bottom: 131, width: 852, height: 131 });
  assert.deepEqual(guideBandRect('middle', screen), { left: 0, top: 131, right: 852, bottom: 262, width: 852, height: 131 });
  assert.deepEqual(guideBandRect('bottom', screen), { left: 0, top: 262, right: 852, bottom: 393, width: 852, height: 131 });
});

test('guide band: bottom by default, top when the bottom covers a target, middle when both edges do', () => {
  assert.equal(chooseGuideBand(screen), 'bottom');
  assert.equal(chooseGuideBand(screen, [box(400, 150, 80, 60)]), 'bottom', 'a target in the middle band leaves the bottom free');
  assert.equal(chooseGuideBand(screen, [box(300, 330, 90, 63)]), 'top', 'a hand card at the bottom');
  assert.equal(chooseGuideBand(screen, [box(300, 330, 90, 63), box(800, 10, 40, 40)]), 'middle');
  assert.equal(chooseGuideBand(screen, [box(0, 0, 0, 0), box(10, 380, 0, 5)]), 'bottom', 'empty rectangles are ignored');
});

test('guide band: with every band covered, the one covering least; a step that names its band gets it', () => {
  const tall = box(10, 0, 100, 393), low = box(300, 300, 200, 93);
  assert.equal(chooseGuideBand(screen, [tall, low]), 'top', 'the tall panel is in every band; the low card only at the bottom');
  assert.equal(chooseGuideBand(screen, [tall]), 'bottom', 'a tie keeps the order');
  assert.equal(chooseGuideBand(screen, [box(300, 330, 90, 63)], 'bottom'), 'bottom', 'named by the step');
  assert.equal(chooseGuideBand(screen, [box(300, 330, 90, 63)], 'side'), 'top', 'an unknown name is ignored');
});
