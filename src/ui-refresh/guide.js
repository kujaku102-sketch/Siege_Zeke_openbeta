// Retain the original 20%-based width and portrait; enlarge only speech by 15%.
// This is the minimum frame; the live speech box grows to fit its content.
function guideSize(viewport) {
  const width = Math.max(1, viewport.width - 16), height = Math.max(1, viewport.height - 16);
  const scale = Math.min(1, Math.sqrt(viewport.width * viewport.height * .2 / (300 * 220)), width / 300, height / 220);
  // Reserve two text lines and the action row before giving space to the portrait.
  const castHeight = Math.min(110 * scale, Math.max(0, 220 * scale - 110));
  const speechHeight = (220 * scale - castHeight) * 1.15;
  return { width: 300 * scale, height: Math.min(height, castHeight + speechHeight), castHeight };
}

export function prepareGuideContent(guide, viewport) {
  const base = guideSize(viewport);
  guide.style.setProperty("--guide-cast-width", `${base.width}px`);
  guide.style.setProperty("--guide-cast-height", `${base.castHeight}px`);
  guide.style.setProperty("--guide-speech-min-height", `${base.height - base.castHeight}px`);
  guide.dataset.measuring = "true";
}

export function measureGuideContent(guide, viewport, pageTexts = []) {
  const speech = guide.querySelector(".live-guide-speech");
  const text = guide.querySelector(".live-guide-text");
  const style = getComputedStyle(speech);
  const inset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  // Measure the actual rendered font (including ruby), not an estimated character count.
  let naturalWidth = text.getBoundingClientRect().width;
  // A line over several pages takes its widest page, so the box keeps one width while the pages turn.
  const line = text.querySelector("p");
  if (line && pageTexts.length > 1) {
    const probe = line.cloneNode(false);
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:0;top:0;width:max-content;white-space:nowrap;visibility:hidden;pointer-events:none";
    text.append(probe);
    for (const page of pageTexts) { probe.textContent = page; naturalWidth = Math.max(naturalWidth, probe.getBoundingClientRect().width); }
    probe.remove();
  }
  const base = guideSize(viewport);
  return Math.min(Math.max(1, viewport.width - 16), Math.max(base.width, Math.ceil(naturalWidth + inset)));
}

export function commitGuideContent(guide, width) {
  guide.style.setProperty("--guide-width", `${width}px`);
  delete guide.dataset.measuring;
  // Height is intrinsic: wrapped dialogue and error text expand the frame, never a scroll pane.
}

// Lines a text takes in the widest speech box this screen allows: a hidden twin of the dialogue line, so the
// count follows the real font, letter spacing and wrapping (including kinsoku). Pages are cut against it.
export function createGuideLineCounter(guide, viewport) {
  const speech = guide.querySelector(".live-guide-speech"), line = guide.querySelector(".live-guide-text p");
  if (!speech || !line) return null;
  const style = getComputedStyle(speech);
  const inset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  const width = Math.max(1, Math.floor(viewport.width - 16 - inset));
  const probe = guide.ownerDocument.createElement("p");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;left:0;top:0;width:${width}px;margin:0;white-space:normal;visibility:hidden;pointer-events:none`;
  line.parentElement.append(probe);
  const lineHeight = parseFloat(getComputedStyle(probe).lineHeight) || 1;
  return {
    width,
    count(text) { probe.textContent = text; return Math.max(1, Math.round(probe.getBoundingClientRect().height / lineHeight)); },
    dispose() { probe.remove(); }
  };
}
