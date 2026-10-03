// Retain the original 20%-based width and portrait; enlarge only speech by 15%.
// This is the minimum frame; the live speech box grows to fit its content.
export function guideSize(viewport) {
  const width = Math.max(1, viewport.width - 16), height = Math.max(1, viewport.height - 16);
  const scale = Math.min(1, Math.sqrt(viewport.width * viewport.height * .2 / (300 * 220)), width / 300, height / 220);
  // Reserve two text lines and the action row before giving space to the portrait.
  const castHeight = Math.min(110 * scale, Math.max(0, 220 * scale - 110));
  const speechHeight = (220 * scale - castHeight) * 1.15;
  return { width: 300 * scale, height: Math.min(height, castHeight + speechHeight), castHeight };
}

export function fitGuideContent(guide, viewport) {
  const base = guideSize(viewport);
  guide.style.setProperty("--guide-cast-width", `${base.width}px`);
  guide.style.setProperty("--guide-cast-height", `${base.castHeight}px`);
  guide.style.setProperty("--guide-speech-min-height", `${base.height - base.castHeight}px`);
  const speech = guide.querySelector(".live-guide-speech");
  const text = guide.querySelector(".live-guide-text");
  const style = getComputedStyle(speech);
  const inset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  // Measure the actual rendered font (including ruby), not an estimated character count.
  guide.dataset.measuring = "true";
  const naturalWidth = text.getBoundingClientRect().width;
  delete guide.dataset.measuring;
  const width = Math.min(Math.max(1, viewport.width - 16), Math.max(base.width, Math.ceil(naturalWidth + inset)));
  guide.style.setProperty("--guide-width", `${width}px`);
  // Height is intrinsic: wrapped dialogue and error text expand the frame, never a scroll pane.
}
