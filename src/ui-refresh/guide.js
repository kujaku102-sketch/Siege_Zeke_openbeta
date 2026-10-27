import { guideBandRect, guideBandHeight } from "./guide-band.js";

// The guide fills one of the screen bands (guide-band.js): the speech frame across, the portrait at its left
// standing out of the band at PORTRAIT_SCALE times the band's height (文豪, 2026-10-27: 1.6), its own background let through.
const INSET = 4;
const PORTRAIT_SCALE = 1.6;
// The navigator art's shape (540×640); other art is fitted inside this box.
const PORTRAIT_ASPECT = 540 / 640;

export function guidePortraitSize(viewport) {
  const height = (guideBandHeight(viewport) - 2 * INSET) * PORTRAIT_SCALE;
  return { width: Math.round(height * PORTRAIT_ASPECT), height };
}

// The band's geometry goes on the match view, not on the guide: a guide redrawn for its next page keeps it.
export function applyGuideBand(view, band, viewport) {
  const rect = guideBandRect(band, viewport), portrait = guidePortraitSize(viewport);
  view.dataset.guideBand = band;
  view.style.setProperty("--guide-band-top", `${rect.top}px`);
  view.style.setProperty("--guide-band-height", `${rect.height}px`);
  view.style.setProperty("--guide-inset", `${INSET}px`);
  view.style.setProperty("--guide-portrait-width", `${portrait.width}px`);
  view.style.setProperty("--guide-portrait-height", `${portrait.height}px`);
}

// Lines a text takes in the speech frame as laid out on this screen: a hidden twin of the dialogue line set to
// the text column's width, so the count follows the real font, letter spacing and wrapping (kinsoku included).
// `lines` is how many lines the column holds; one is kept free for a refused move's reason under the text.
export function createGuideLineCounter(guide) {
  const text = guide.querySelector(".live-guide-text"), line = text?.querySelector("p");
  if (!text || !line) return null;
  const width = Math.max(1, Math.floor(text.clientWidth));
  const probe = guide.ownerDocument.createElement("p");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;left:0;top:0;width:${width}px;margin:0;white-space:normal;visibility:hidden;pointer-events:none`;
  text.append(probe);
  const lineHeight = parseFloat(getComputedStyle(probe).lineHeight) || 1;
  const fits = Math.max(1, Math.floor((text.clientHeight + 1) / lineHeight));
  return {
    width,
    fits,
    lines: Math.max(1, fits - 1),
    count(value) { probe.textContent = value; return Math.max(1, Math.round(probe.getBoundingClientRect().height / lineHeight)); },
    dispose() { probe.remove(); }
  };
}
