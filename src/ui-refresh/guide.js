import { guideLayout } from "./guide-band.js";

// The guide is one group (guide-band.js): the speech frame across the screen and the portrait at its left,
// standing on the frame's bottom edge and reaching up out of it, its own background let through.
// The navigator art's shape (540×640); other art is fitted inside this box.
export const GUIDE_PORTRAIT_ASPECT = 540 / 640;

// The group's geometry goes on the match view, not on the guide: a guide redrawn for its next page keeps it.
// Every value is a ratio of the screen (guideLayout), written as px for this screen.
export function applyGuideBand(view, band, viewport) {
  const { frame, portrait, box } = guideLayout(band, viewport, GUIDE_PORTRAIT_ASPECT);
  view.dataset.guideBand = band;
  view.style.setProperty("--guide-top", `${box.top}px`);
  view.style.setProperty("--guide-left", `${box.left}px`);
  view.style.setProperty("--guide-height", `${frame.height}px`);
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
