// Card detail opens with a square of artwork clear above the text. Scrolling the
// text up over the art dims it, so the art stays visible yet the text stays readable.
export function attachDetailScroll({ root, signal }) {
  root.addEventListener?.('scroll', event => {
    const panel = event.target;
    if (!panel?.classList?.contains('r2-detail')) return;
    const span = panel.clientWidth * .6 || 1;
    panel.style.setProperty('--detail-dim', Math.min(1, panel.scrollTop / span).toFixed(3));
  }, { capture: true, passive: true, signal });
}
