import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_BAND_ORDER, GUIDE_BAND_RATIO, GUIDE_INSET_RATIO, GUIDE_PORTRAIT_SCALE, guideBandHeight, guideLayout, chooseGuideBand } from '../src/ui-refresh/guide-band.js';

const phone = { width: 852, height: 393 }, phoneMax = { width: 932, height: 430 }, pc = { width: 1280, height: 720 }, hd = { width: 1920, height: 1080 };
const SCREENS = [hd, pc, phone, phoneMax];
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);
const ASPECT = 540 / 640;

test('guide band: a third of the height on every screen, a PC\'s as a phone\'s (文豪, 2026-10-27)', () => {
  assert.deepEqual([GUIDE_BAND_RATIO, GUIDE_INSET_RATIO, GUIDE_PORTRAIT_SCALE], [1 / 3, .01, 1.6]);
  for (const screen of SCREENS) near(guideBandHeight(screen) / screen.height, 1 / 3, `${screen.width}×${screen.height} band / height`);
  assert.equal(guideBandHeight(hd), 360, 'no cap on a tall screen');
});

test('guide text: 4.2% of the height on every screen; the floor (15px at the default root size) only keeps it readable', () => {
  const css = readFileSync(new URL('../src/ui-refresh/live.css', import.meta.url), 'utf8');
  assert.match(css, /--guide-font:max\(\.9375rem,4\.2dvh\);/);
  const font = height => Math.max(.9375 * 16, height * .042);
  for (const screen of SCREENS) near(font(screen.height) / screen.height, .042, `${screen.width}×${screen.height} text / height`);
});

test('guide group: the portrait stands on the frame\'s bottom edge; bottom band on the screen\'s bottom, top band from the screen\'s top, middle centred', () => {
  for (const screen of SCREENS) {
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
