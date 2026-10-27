// Where the tutorial guide sits (文豪, 2026-10-27): the screen is cut into three horizontal bands and the guide
// fills one of them edge to edge, never anywhere in between, so it does not wander from step to step. A band
// that would cover what the step points at is skipped, in GUIDE_BAND_ORDER; a step may name its band
// ('top' | 'middle' | 'bottom') and is then placed there as written. DOM-free: rectangles in, a band out.
//
// 仮置き (sz-ui の推奨、文豪の返事待ち): the order starts at the top, and a tall screen's band is capped at
// GUIDE_BAND_MAX_RATIO of its height or GUIDE_BAND_MAX_PX, whichever is smaller.
export const GUIDE_BAND_ORDER = Object.freeze(['top', 'bottom', 'middle']);
export const GUIDE_BAND_MAX_PX = 180;
export const GUIDE_BAND_MAX_RATIO = .25;

// A third of the screen, unless that is more than the cap (a PC screen): then the cap.
export function guideBandHeight(viewport) {
  const third = viewport.height / 3;
  return third > GUIDE_BAND_MAX_PX ? Math.min(viewport.height * GUIDE_BAND_MAX_RATIO, GUIDE_BAND_MAX_PX) : third;
}

// Top band at the top edge, bottom band at the bottom edge, middle band centred.
export function guideBandRect(band, viewport) {
  const height = guideBandHeight(viewport);
  const top = { top: 0, middle: (viewport.height - height) / 2, bottom: viewport.height - height }[band];
  return { left: 0, top, right: viewport.width, bottom: top + height, width: viewport.width, height };
}

// The portrait stands at the guide's left and is taller than the band: it reaches down from the top band and
// up from the others. `portrait` is its { width, height } on screen.
export function guidePortraitRect(band, viewport, portrait) {
  const rect = guideBandRect(band, viewport);
  const top = band === 'top' ? rect.top : rect.bottom - portrait.height;
  return { left: rect.left, top, right: rect.left + portrait.width, bottom: top + portrait.height, width: portrait.width, height: portrait.height };
}

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// targets: the screen rectangles of the step's highlights and controls. A band covers them with the band itself
// and with the portrait standing out of it. With every band covering something, the band covering least wins
// (ties keep the order).
export function chooseGuideBand(viewport, targets = [], preferred = null, { portrait = null } = {}) {
  if (GUIDE_BAND_ORDER.includes(preferred)) return preferred;
  const visible = targets.filter(rect => rect && rect.right > rect.left && rect.bottom > rect.top);
  let best = null;
  for (const band of GUIDE_BAND_ORDER) {
    const areas = [guideBandRect(band, viewport), ...(portrait ? [guidePortraitRect(band, viewport, portrait)] : [])];
    const covered = visible.reduce((sum, target) => sum + Math.max(...areas.map(area => overlap(area, target))), 0);
    if (covered === 0) return band;
    if (!best || covered < best.covered) best = { band, covered };
  }
  return best.band;
}
