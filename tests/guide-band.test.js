import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_BAND_ORDER, GUIDE_BAND_MAX_REM, GUIDE_BAND_MAX_RATIO, GUIDE_INSET_RATIO, GUIDE_PORTRAIT_SCALE, guideBandHeight, guideLayout, chooseGuideBand } from '../src/ui-refresh/guide-band.js';

const phone = { width: 852, height: 393 }, small = { width: 640, height: 360 }, pc = { width: 1280, height: 720 };
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);
const ASPECT = 540 / 640;

test('guide band: thirds on a phone, capped on a PC (仮: 25% of the height or 11.25rem, the smaller)', () => {
  assert.deepEqual([GUIDE_BAND_MAX_REM, GUIDE_BAND_MAX_RATIO, GUIDE_INSET_RATIO, GUIDE_PORTRAIT_SCALE], [11.25, .25, .01, 1.6]);
  assert.equal(guideBandHeight(phone), 131);
  assert.equal(guideBandHeight(small), 120);
  assert.equal(guideBandHeight(pc), 180);
  assert.equal(guideBandHeight({ width: 1920, height: 1080 }), 180);
  assert.equal(guideBandHeight({ width: 1024, height: 600 }), 150, '200 is over the cap; a quarter is 150');
  assert.equal(guideBandHeight({ width: 1280, height: 720, rem: 20 }), 180, 'a larger root font raises the cap: a quarter wins');
});

test('guide group: the portrait stands on the frame\'s bottom edge; bottom band on the screen\'s bottom, top band from the screen\'s top, middle centred', () => {
  for (const screen of [phone, small, pc]) {
    const inset = screen.height * GUIDE_INSET_RATIO, frameHeight = guideBandHeight(screen) - 2 * inset;
    for (const band of ['top', 'middle', 'bottom']) {
      const { frame, portrait, group } = guideLayout(band, screen, ASPECT);
      near(frame.height, frameHeight, `${band} frame height`);
      near(portrait.height, frameHeight * GUIDE_PORTRAIT_SCALE, `${band} portrait height`);
      near(portrait.width, portrait.height * ASPECT, `${band} portrait width`);
      near(portrait.bottom, frame.bottom, `${band}: bottoms line up`);
      assert.ok(portrait.top < frame.top, `${band}: the portrait reaches up only`);
      near(frame.left, portrait.right, `${band}: the frame starts after the portrait`);
      assert.ok(group.top >= inset - 1e-9 && group.bottom <= screen.height - inset + 1e-9, `${band}: the group stays on screen`);
      assert.ok(group.left >= 0 && frame.right <= screen.width - inset + 1e-9, `${band}: inside the width`);
    }
    near(guideLayout('bottom', screen, ASPECT).frame.bottom, screen.height - inset, 'bottom band: the frame on the bottom edge');
    near(guideLayout('top', screen, ASPECT).portrait.top, inset, 'top band: the portrait from the top edge');
    const middle = guideLayout('middle', screen, ASPECT).group;
    near(middle.top + middle.height / 2, screen.height / 2, 'middle band: the group centred');
  }
  // On 852×393: frame 123.14 tall, portrait 197.02 tall — the top band's frame ends 201 down.
  const top = guideLayout('top', phone, ASPECT);
  assert.deepEqual([top.frame.top, top.frame.bottom].map(Math.round), [78, 201]);
});

test('guide band: chosen against what the group takes — the portrait and the frame, not the free corner above the frame', () => {
  assert.deepEqual([...GUIDE_BAND_ORDER], ['top', 'bottom', 'middle']);
  assert.equal(chooseGuideBand(phone, [], null, { aspect: ASPECT }), 'top');
  const topFrame = guideLayout('top', phone, ASPECT).frame;
  assert.equal(chooseGuideBand(phone, [box(500, 20, 60, 40)], null, { aspect: ASPECT }), 'top', 'above the top band\'s frame, beside the portrait: free');
  assert.equal(chooseGuideBand(phone, [box(500, topFrame.top + 5, 60, 40)], null, { aspect: ASPECT }), 'bottom', 'under the top band\'s frame');
  assert.equal(chooseGuideBand(phone, [box(20, 20, 40, 40)], null, { aspect: ASPECT }), 'bottom', 'under the top band\'s portrait');
  assert.equal(chooseGuideBand(phone, [box(500, 100, 60, 40), box(500, 330, 60, 40)], null, { aspect: ASPECT }), 'middle', 'both edges taken');
  assert.equal(chooseGuideBand(phone, [box(0, 0, 0, 0)], null, { aspect: ASPECT }), 'top', 'empty rectangles are ignored');
});

test('guide band: with every band covered, the one covering least; a step that names its band gets it', () => {
  const tall = box(300, 0, 100, 393);
  assert.equal(chooseGuideBand(phone, [tall], null, { aspect: ASPECT }), 'top', 'a tie keeps the order');
  assert.equal(chooseGuideBand(phone, [tall, box(500, 100, 200, 40)], null, { aspect: ASPECT }), 'bottom');
  assert.equal(chooseGuideBand(phone, [box(500, 100, 60, 40)], 'top', { aspect: ASPECT }), 'top', 'named by the step');
  assert.equal(chooseGuideBand(phone, [box(500, 100, 60, 40)], 'side', { aspect: ASPECT }), 'bottom', 'an unknown name is ignored');
});
