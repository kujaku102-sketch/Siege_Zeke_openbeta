// Where the tutorial guide sits (文豪, 2026-10-27): the screen is cut into three equal horizontal bands and
// the guide fills one of them edge to edge, never anywhere in between, so it does not wander from step to
// step. The bottom band is the default; a band that would cover what the step points at is skipped
// (bottom, then top, then middle). A step may name its band ('top' | 'middle' | 'bottom') and is then
// placed there as written. DOM-free: rectangles in, a band name out.
export const GUIDE_BANDS = Object.freeze(['bottom', 'top', 'middle']);
const ROW = Object.freeze({ top: 0, middle: 1, bottom: 2 });

export function guideBandRect(band, viewport) {
  const height = viewport.height / 3;
  return { left: 0, top: ROW[band] * height, right: viewport.width, bottom: (ROW[band] + 1) * height, width: viewport.width, height };
}

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// targets: the screen rectangles of the step's highlights and controls. With every band covering something,
// the band covering least wins (ties keep the order above).
export function chooseGuideBand(viewport, targets = [], preferred = null) {
  if (Object.hasOwn(ROW, preferred ?? '')) return preferred;
  const visible = targets.filter(rect => rect && rect.right > rect.left && rect.bottom > rect.top);
  let best = null;
  for (const band of GUIDE_BANDS) {
    const rect = guideBandRect(band, viewport);
    const covered = visible.reduce((sum, target) => sum + overlap(rect, target), 0);
    if (covered === 0) return band;
    if (!best || covered < best.covered) best = { band, covered };
  }
  return best.band;
}
