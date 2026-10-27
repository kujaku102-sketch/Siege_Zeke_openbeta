const VIEW_STORAGE_KEY = "sz-r2-view";
const isView = value => value === "pc" || value === "mobile";

// Entry routing only. A resize or input-device change never changes the chosen UI.
export function resolveView({ pathname = "", saved, mobile, userAgent = "", maxTouchPoints = 0 } = {}) {
  const explicit = pathname.match(/^\/(pc|mobile)(?:\/|$)/)?.[1];
  if (explicit) return { view: explicit, source: "url" };
  if (isView(saved)) return { view: saved, source: "saved" };
  // Tablets requesting desktop sites can resemble a Mac; do not silently force PC.
  if (/iPad|Tablet/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
      || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return { view: null, source: "ambiguous" };
  if (typeof mobile === "boolean") return { view: mobile ? "mobile" : "pc", source: "client-hint" };
  if (/iPhone|iPod|Android.+Mobile|Windows Phone/i.test(userAgent)) return { view: "mobile", source: "user-agent" };
  if (/Windows NT|Macintosh|X11|CrOS/i.test(userAgent)) return { view: "pc", source: "user-agent" };
  return { view: null, source: "unknown" };
}

// iOS and iPadOS run every browser on WebKit, whose WebGL and graphics-memory limits drop a
// context mid-match. iPadOS asks for the desktop site, so it reports as a Mac: a Mac that has
// touch points is an iPad (no shipping Mac has a touchscreen). Used only to skip WebGL scenes.
export function isIosWebKit({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPod|iPad/i.test(userAgent)) return true;
  return (/Macintosh/i.test(userAgent) || platform === "MacIntel") && maxTouchPoints > 1;
}

export function readSavedView(storage) {
  try { const value = storage?.getItem(VIEW_STORAGE_KEY); return isView(value) ? value : null; }
  catch { return null; }
}
export function saveView(storage, view) {
  if (!isView(view)) return false;
  try { storage.setItem(VIEW_STORAGE_KEY, view); return true; } catch { return false; }
}

export function fitBoard(width, height) {
  const w = Math.max(0, Math.min(width, height * 4 / 3));
  return { width: w, height: w * 3 / 4 };
}

export function placePopup(anchor, popup, viewport, margin = 8) {
  const leftEdge = (viewport.left ?? 0) + margin;
  const topEdge = (viewport.top ?? 0) + margin;
  const rightEdge = (viewport.left ?? 0) + viewport.width - margin;
  const bottomEdge = (viewport.top ?? 0) + viewport.height - margin;
  const above = anchor.top - popup.height - margin;
  const side = above < topEdge ? "below" : "above";
  const top = side === "below" ? anchor.bottom + margin : above;
  const preferredLeft = anchor.left + (anchor.width - popup.width) / 2;
  const left = Math.max(leftEdge, Math.min(preferredLeft, rightEdge - popup.width));
  return { left, top, side, overflow: popup.width > rightEdge - leftEdge || top + popup.height > bottomEdge };
}

// A card's popup keeps clear of what sits over it (the tutorial guide, 文豪 2026-10-27): beside its card, tried
// above, below, left, then right, each inside the bounds and never over `keep` (what the player is asked to press).
// The first clear place wins; with none clear, the one covered least (ties keep that order). Null when no side fits.
export function placePopupClear(anchor, popup, viewport, margin = 8, obstacles = [], keep = []) {
  const x0 = (viewport.left ?? 0) + margin, y0 = (viewport.top ?? 0) + margin;
  const x1 = (viewport.left ?? 0) + viewport.width - margin - popup.width, y1 = (viewport.top ?? 0) + viewport.height - margin - popup.height;
  const left = Math.max(x0, Math.min(anchor.left + (anchor.width - popup.width) / 2, x1));
  const top = Math.max(y0, Math.min(anchor.top + (anchor.height - popup.height) / 2, y1));
  const places = [{ side: 'above', left, top: anchor.top - popup.height - margin }, { side: 'below', left, top: anchor.bottom + margin },
    { side: 'left', left: anchor.left - popup.width - margin, top }, { side: 'right', left: anchor.right + margin, top }]
    .filter(place => place.left >= x0 - .5 && place.left <= x1 + .5 && place.top >= y0 - .5 && place.top <= y1 + .5);
  const over = (place, rects) => rects.reduce((sum, rect) => sum + Math.max(0, Math.min(place.left + popup.width, rect.right) - Math.max(place.left, rect.left))
    * Math.max(0, Math.min(place.top + popup.height, rect.bottom) - Math.max(place.top, rect.top)), 0);
  let best = null;
  for (const place of places.filter(place => over(place, keep) === 0)) {
    const covered = over(place, obstacles);
    if (covered === 0) return { ...place, covered };
    if (!best || covered < best.covered - 1) best = { ...place, covered };
  }
  return best;
}

export function cardSelection(selection, uid, { inspect = false, blocked = false } = {}) {
  if (blocked || !uid) return selection;
  return inspect ? { ...selection, detailUid: uid }
    : { selectedUid: uid, detailUid: uid };
}
export const clearSelection = () => ({ selectedUid: null, detailUid: null });

// Pure gesture classifier; movement thresholds are provisional, not rule values.
export function gestureMoved(start, current, threshold = 10) {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}
export function avoidFocus(panel, targets, viewport, margin = 8) {
  const width = Math.min(panel.width, viewport.width - margin * 2), height = Math.min(panel.height, viewport.height - margin * 2);
  const x0 = (viewport.left ?? 0) + margin, y0 = (viewport.top ?? 0) + margin;
  const x1 = x0 + viewport.width - width - margin * 2, y1 = y0 + viewport.height - height - margin * 2;
  const candidates = [{ left: x1, top: y0 }, { left: x0, top: y0 }, { left: x1, top: y1 }, { left: x0, top: y1 }];
  // A larger ADV frame may fit between the detail panel and console, not at a corner.
  const xs = new Set([x0, x1]), ys = new Set([y0, y1]);
  for (const rect of targets) {
    for (const x of [rect.right + margin, rect.left - width - margin]) xs.add(Math.max(x0, Math.min(x1, x)));
    for (const y of [rect.bottom + margin, rect.top - height - margin]) ys.add(Math.max(y0, Math.min(y1, y)));
  }
  for (const left of xs) for (const top of ys) candidates.push({ left, top });
  const overlap = pos => targets.reduce((sum, rect) => sum + Math.max(0, Math.min(pos.left + width, rect.right + margin) - Math.max(pos.left, rect.left - margin)) * Math.max(0, Math.min(pos.top + height, rect.bottom + margin) - Math.max(pos.top, rect.top - margin)), 0);
  return candidates.map(pos => ({ ...pos, overlap: overlap(pos) })).sort((a, b) => a.overlap - b.overlap)[0];
}
