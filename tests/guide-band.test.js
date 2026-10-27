import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_BAND_ORDER, GUIDE_BAND_MAX_REM, GUIDE_BAND_MAX_RATIO, guideBandHeight, guideBandRect, guidePortraitRect, chooseGuideBand } from '../src/ui-refresh/guide-band.js';

const phone = { width: 852, height: 393 }, pc = { width: 1280, height: 720 };
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

test('guide band: thirds on a phone, capped on a PC (仮: 25% of the height or 11.25rem, the smaller)', () => {
  assert.deepEqual([GUIDE_BAND_MAX_REM, GUIDE_BAND_MAX_RATIO], [11.25, .25]);
  assert.equal(guideBandHeight({ width: 1280, height: 720, rem: 20 }), 180, 'a larger root font raises the cap: a quarter wins');
  assert.equal(guideBandHeight(phone), 131);
  assert.equal(guideBandHeight({ width: 640, height: 360 }), 120);
  assert.equal(guideBandHeight(pc), 180);
  assert.equal(guideBandHeight({ width: 1920, height: 1080 }), 180);
  assert.equal(guideBandHeight({ width: 1024, height: 600 }), 150, '200 is over the cap; a quarter is 150');
  assert.deepEqual(guideBandRect('top', phone), { left: 0, top: 0, right: 852, bottom: 131, width: 852, height: 131 });
  assert.deepEqual(guideBandRect('middle', phone), { left: 0, top: 131, right: 852, bottom: 262, width: 852, height: 131 });
  assert.deepEqual(guideBandRect('bottom', pc), { left: 0, top: 540, right: 1280, bottom: 720, width: 1280, height: 180 });
  assert.deepEqual(guideBandRect('middle', pc), { left: 0, top: 270, right: 1280, bottom: 450, width: 1280, height: 180 });
});

test('guide band: top by default (仮), bottom when the top covers a target, middle when both edges do', () => {
  assert.deepEqual([...GUIDE_BAND_ORDER], ['top', 'bottom', 'middle']);
  assert.equal(chooseGuideBand(phone), 'top');
  assert.equal(chooseGuideBand(phone, [box(400, 150, 80, 60)]), 'top', 'a target in the middle band leaves the top free');
  assert.equal(chooseGuideBand(phone, [box(800, 10, 40, 40)]), 'bottom', 'the opponent at the top');
  assert.equal(chooseGuideBand(phone, [box(300, 330, 90, 63), box(800, 10, 40, 40)]), 'middle');
  assert.equal(chooseGuideBand(phone, [box(0, 0, 0, 0), box(10, 20, 0, 5)]), 'top', 'empty rectangles are ignored');
});

test('guide band: the portrait standing out of the band counts as covering', () => {
  const portrait = { width: 208, height: 246 };
  assert.deepEqual(guidePortraitRect('top', phone, portrait), { left: 0, top: 0, right: 208, bottom: 246, width: 208, height: 246 });
  assert.deepEqual(guidePortraitRect('bottom', phone, portrait), { left: 0, top: 147, right: 208, bottom: 393, width: 208, height: 246 });
  const underPortrait = box(40, 135, 60, 8);
  assert.equal(chooseGuideBand(phone, [underPortrait]), 'top', 'without the portrait the top band is free');
  assert.equal(chooseGuideBand(phone, [underPortrait], null, { portrait }), 'bottom', 'the portrait reaches down from the top band; from the bottom it stops short');
});

test('guide band: with every band covered, the one covering least; a step that names its band gets it', () => {
  const tall = box(10, 0, 100, 393), high = box(300, 10, 200, 60);
  assert.equal(chooseGuideBand(phone, [tall, high]), 'bottom', 'the tall panel is in every band; the high card only at the top');
  assert.equal(chooseGuideBand(phone, [tall]), 'top', 'a tie keeps the order');
  assert.equal(chooseGuideBand(phone, [box(800, 10, 40, 40)], 'top'), 'top', 'named by the step');
  assert.equal(chooseGuideBand(phone, [box(800, 10, 40, 40)], 'side'), 'bottom', 'an unknown name is ignored');
});
