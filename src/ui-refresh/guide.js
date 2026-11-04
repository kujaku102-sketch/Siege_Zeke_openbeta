import { guideLayout, GUIDE_MIN_LINE_EM } from "./guide-band.js";

// The guide is one group (guide-band.js): the speech frame across the screen and the portrait at its left,
// standing on the frame's bottom edge and reaching up out of it, its own background let through.
// The navigator art's shape (540×640); other art is fitted inside this box.
export const GUIDE_PORTRAIT_ASPECT = 540 / 640;

// The group's geometry goes on the match view, not on the guide: a guide redrawn for its next page keeps it.
// Every value is a ratio of the screen (guideLayout), written as px for this screen; grow is the page's own.
// options: guideLayout's reserve (the HUD column kept free), fit (the frame cut to its line) and minFrame (the
// portrait's column narrowed, shown from the chest up, where the frame beside it would be narrower).
export function applyGuideBand(view, band, viewport, grow = 0, options = {}) {
  const { frame, portrait, box, bust } = guideLayout(band, viewport, GUIDE_PORTRAIT_ASPECT, grow, options);
  view.dataset.guideBand = band;
  view.dataset.guideFit = options.fit > 0 ? "line" : "band";
  view.dataset.guideBust = bust ? "on" : "off";
  view.style.setProperty("--guide-top", `${box.top}px`);
  view.style.setProperty("--guide-left", `${box.left}px`);
  view.style.setProperty("--guide-right", `${viewport.width - box.right}px`);
  view.style.setProperty("--guide-height", `${frame.height}px`);
  view.style.setProperty("--guide-portrait-width", `${portrait.width}px`);
  view.style.setProperty("--guide-portrait-height", `${portrait.height}px`);
}

// The frame's least width on this screen (px): GUIDE_MIN_LINE_EM of the guide's type for the text, and the frame's
// own sides as laid out now (border, padding, and on a phone the buttons' column).
export function guideMinFrame(guide) {
  const speech = guide.querySelector(".live-guide-speech"), text = guide.querySelector(".live-guide-text");
  if (!speech || !text) return 0;
  const font = parseFloat(guide.ownerDocument.defaultView.getComputedStyle(guide).fontSize) || 0;
  return Math.ceil(GUIDE_MIN_LINE_EM * font + Math.max(0, speech.getBoundingClientRect().width - text.clientWidth));
}

// The height the frame needs for its buttons where they stand in a column at its right (phones): the column's items
// as laid out now, with the frame's border and padding. Where they share the name's line (PC) the text's own count
// holds them already: 0. A frame cut to its line ((i)) is never cut below this.
export function guideNavHeight(guide) {
  const speech = guide.querySelector(".live-guide-speech"), nav = speech?.querySelector("nav");
  if (!nav) return 0;
  const style = guide.ownerDocument.defaultView.getComputedStyle(speech);
  if (!style.gridTemplateAreas.includes('"text nav"')) return 0;
  const items = [...nav.children].map(item => item.getBoundingClientRect().height).filter(height => height > 0);
  if (!items.length) return 0;
  const sides = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce((sum, name) => sum + (parseFloat(style[name]) || 0), 0);
  return Math.ceil(items.reduce((sum, height) => sum + height, 0) + sides);
}

// The head's height with every button a page shows ([n/m], [戻る], [次へ]): on a PC the buttons drop under the name
// where its line is too short, as a later page's [戻る] may make them on a narrow frame (a 4:3 screen), so the frame
// is sized for that from the first page (文豪, 2026-11-04). A phone's head is no box (its buttons a column): as it is.
function headHeight(head) {
  if (!head || head.ownerDocument.defaultView.getComputedStyle(head).display === "contents") return head?.getBoundingClientRect().height ?? 0;
  const twin = head.cloneNode(true);
  twin.setAttribute("aria-hidden", "true");
  twin.querySelector("nav").innerHTML = '<small class="live-guide-page">9/9</small><span class="live-guide-turn"><button class="live-guide-prev" tabindex="-1">◂ 戻る</button><button class="live-guide-next" tabindex="-1">次へ ▸</button></span>';
  twin.style.cssText = `position:absolute;left:0;top:0;width:${head.clientWidth}px;visibility:hidden;pointer-events:none`;
  head.parentElement.append(twin);
  const height = twin.getBoundingClientRect().height;
  twin.remove();
  return Math.max(height, head.getBoundingClientRect().height);
}

// Lines a text takes in the speech frame as laid out on this screen: a hidden twin of the dialogue line set to
// the text column's width, so the count follows the real font, letter spacing and wrapping (kinsoku included).
// frameHeight(text): the frame a page needs, its text plus one free line for a refused move's reason under it,
// with the frame's own border, padding and the space above the text (whatever height the frame has now), the head
// counted as tall as any page of the line makes it (headHeight).
export function createGuideLineCounter(guide) {
  const speech = guide.querySelector(".live-guide-speech"), text = guide.querySelector(".live-guide-text"), line = text?.querySelector("p");
  if (!speech || !text || !line) return null;
  const width = Math.max(1, Math.floor(text.clientWidth));
  const probe = guide.ownerDocument.createElement("p");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;left:0;top:0;width:${width}px;margin:0;white-space:normal;visibility:hidden;pointer-events:none`;
  text.append(probe);
  const lineHeight = parseFloat(getComputedStyle(probe).lineHeight) || 1;
  const head = guide.querySelector(".live-guide-head"), headNow = head?.getBoundingClientRect().height ?? 0;
  const chrome = speech.getBoundingClientRect().height - text.clientHeight + Math.max(0, headHeight(head) - headNow);
  const count = value => { probe.textContent = value; return Math.max(1, Math.round(probe.getBoundingClientRect().height / lineHeight)); };
  return {
    width,
    lineHeight,
    count,
    frameHeight(value) { return Math.ceil(chrome + (count(value) + 1) * lineHeight); },
    dispose() { probe.remove(); }
  };
}
