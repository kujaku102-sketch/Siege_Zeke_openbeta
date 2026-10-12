export const VIEW_STORAGE_KEY = "sz-r2-view";
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

export function cardSelection(selection, uid, { inspect = false, blocked = false } = {}) {
  if (blocked || !uid) return selection;
  return inspect ? { ...selection, detailUid: uid }
    : { selectedUid: uid, detailUid: uid };
}
export const clearSelection = () => ({ selectedUid: null, detailUid: null });

// UI-only cancellation. Never consume game history or drop an engine pending.
export function canCancelSelection(selection, { blocked = false } = {}) {
  return !blocked && Boolean(selection.selectedUid || selection.detailUid);
}
export function cancelSelection(selection, options = {}) {
  return canCancelSelection(selection, options) ? clearSelection() : selection;
}

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
