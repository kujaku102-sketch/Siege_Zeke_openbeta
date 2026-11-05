import { fxMs } from "./fx-speed.js";

// A move between two CRT screens (the title and the flow screens) slides inside the glass, as the debug page does in the
// title's menu: the screen left keeps its last page as a picture, and the next screen's page comes in from the right
// over it, going deeper, or from the left, going back. At the effect speed; nothing slides without the CRT (effects off,
// compat), where the screens change at once.
export const SCREEN_SLIDE_MS = 320;
const DEPTH = Object.freeze({ entry: 0, "tutorial-select": 1, "battle-setup": 1, "online-name": 2, "online-entry": 2, "online-join": 3, "online-room": 3 });
// A page kept longer ago than this belongs to an earlier visit (the match came between): it is not slid from.
const FRESH_MS = 1000;

let kept = null;

// 1: the next page comes in from the right (going deeper, or across); -1: from the left (going back toward the title).
export const slideSide = (from, to) => (DEPTH[to] ?? 0) < (DEPTH[from] ?? 0) ? -1 : 1;

// The page a CRT screen showed last, as it leaves.
export function keepCrtPage(source, screen) {
  if (!source?.width || !source?.height) { kept = null; return; }
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d").drawImage(source, 0, 0);
  kept = { page: copy, screen, at: performance.now() };
}

// The slide into `screen`, or null when no CRT page was left just now (or it was this very screen).
export function takeCrtSlide(screen) {
  const from = kept;
  kept = null;
  if (!from || from.screen === screen || performance.now() - from.at > FRESH_MS) return null;
  return { page: from.page, side: slideSide(from.screen, screen), at: performance.now() };
}

// Lays the slide over the page just drawn in `source` (device pixels). Returns false once the slide is over.
export function composeCrtSlide(source, slide) {
  const progress = Math.min(1, (performance.now() - slide.at) / fxMs(SCREEN_SLIDE_MS));
  if (progress >= 1) return false;
  const eased = progress < .5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
  const { width, height } = source;
  const next = document.createElement("canvas");
  next.width = width;
  next.height = height;
  next.getContext("2d").drawImage(source, 0, 0);
  const ctx = source.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(slide.page, -slide.side * eased * width, 0, width, height);
  ctx.drawImage(next, slide.side * (1 - eased) * width, 0);
  ctx.restore();
  return true;
}
