// Card detail opens with the top of the artwork clear above the text (hud-skin.css). Scrolling the
// text up over the art dims it, so the art stays visible yet the text stays readable. The head and the
// card's name stay put; only the body under them (.detail-body) scrolls.
export function attachDetailScroll({ root, signal }) {
  root.addEventListener?.('scroll', event => {
    const body = event.target;
    if (!body?.classList?.contains('detail-body') || !body.closest?.('.r2-detail')) return;
    const span = body.clientWidth * .6 || 1;
    body.style.setProperty('--detail-dim', Math.min(1, body.scrollTop / span).toFixed(3));
  }, { capture: true, passive: true, signal });
}
