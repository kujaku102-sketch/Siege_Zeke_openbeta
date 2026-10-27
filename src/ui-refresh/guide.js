// The guide fills one of three screen bands (guide-band.js): a square portrait on the left, the speech
// frame across the rest. The band's size comes from the screen alone, so the box no longer follows its text.
const INSET = 4;

// The band's geometry goes on the match view, not on the guide: a guide redrawn for its next page keeps it.
export function applyGuideBand(view, band, viewport) {
  view.dataset.guideBand = band;
  view.style.setProperty("--guide-band-height", `${viewport.height / 3}px`);
  view.style.setProperty("--guide-band-top", `${{ top: 0, middle: 1, bottom: 2 }[band] * viewport.height / 3}px`);
  view.style.setProperty("--guide-inset", `${INSET}px`);
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
