// Where the tutorial guide sits (文豪, 2026-10-27): the screen is cut into three horizontal bands and the guide
// takes one of them edge to edge, never anywhere in between, so it does not wander from step to step. The guide is
// a group: the speech frame across the screen, and the portrait at its left standing on the frame's bottom edge
// (their bottoms line up), taller than the frame, so it reaches up only. A band whose group would cover what the
// step points at is skipped, in GUIDE_BAND_ORDER; a step may name its band ('top' | 'middle' | 'bottom') and is
// then placed there as written. DOM-free: rectangles in, rectangles and a band out. Sizes are ratios of the
// screen, never fixed px: the guide takes the same share of every screen, a PC's as a phone's (文豪, 2026-10-27).
//
// 仮置き (sz-ui の推奨、文豪の返事待ち): the order starts at the top.
export const GUIDE_BAND_ORDER = Object.freeze(['top', 'bottom', 'middle']);
// The band's height over the screen's height, on every screen.
export const GUIDE_BAND_RATIO = 1 / 3;
// The gap between the group and the screen's edges, as a share of the screen height.
export const GUIDE_INSET_RATIO = .01;
// The portrait's height over the frame's height (文豪, 2026-10-27: 1.6).
export const GUIDE_PORTRAIT_SCALE = 1.6;

// A third of the screen, on a phone and on a PC alike.
export function guideBandHeight(viewport) {
  return viewport.height * GUIDE_BAND_RATIO;
}

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

// The group on this screen in this band. Bottom band: the frame's bottom on the screen's bottom edge, the portrait
// reaching up. Top band: the portrait's top on the screen's top edge, the frame below it ending where the portrait
// does. Middle band: the group centred on the screen. The group never leaves the screen.
// aspect: the portrait art's width over its height.
export function guideLayout(band, viewport, aspect = 1) {
  const inset = viewport.height * GUIDE_INSET_RATIO;
  const frameHeight = guideBandHeight(viewport) - 2 * inset;
  const portraitHeight = Math.min(frameHeight * GUIDE_PORTRAIT_SCALE, viewport.height - 2 * inset);
  const portraitWidth = portraitHeight * aspect;
  const groupTop = { top: inset, middle: (viewport.height - portraitHeight) / 2, bottom: viewport.height - inset - portraitHeight }[band] ?? inset;
  const groupBottom = groupTop + portraitHeight;
  return {
    band, inset,
    group: rect(inset, groupTop, viewport.width - 2 * inset, portraitHeight),
    portrait: rect(inset, groupTop, portraitWidth, portraitHeight),
    frame: rect(inset + portraitWidth, groupBottom - frameHeight, Math.max(0, viewport.width - 2 * inset - portraitWidth), frameHeight),
    // The guide box: the frame's band across the whole width (the portrait column on its left).
    box: rect(inset, groupBottom - frameHeight, viewport.width - 2 * inset, frameHeight)
  };
}

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// targets: the screen rectangles of the step's highlights and controls. A band covers them with what the group
// actually takes: the portrait and the frame (not the empty corner above the frame beside the portrait). With
// every band covering something, the band covering least wins (ties keep the order).
export function chooseGuideBand(viewport, targets = [], preferred = null, { aspect = 1 } = {}) {
  if (GUIDE_BAND_ORDER.includes(preferred)) return preferred;
  const visible = targets.filter(t => t && t.right > t.left && t.bottom > t.top);
  let best = null;
  for (const band of GUIDE_BAND_ORDER) {
    const { portrait, frame } = guideLayout(band, viewport, aspect);
    const covered = visible.reduce((sum, target) => sum + overlap(portrait, target) + overlap(frame, target), 0);
    if (covered === 0) return band;
    // Less than a square pixel apart is a tie (the bands' sums differ only by rounding).
    if (!best || covered < best.covered - 1) best = { band, covered };
  }
  return best.band;
}
