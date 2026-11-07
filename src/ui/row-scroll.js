// Rows that run sideways (the hand, the deck builder's rows, the profile strip): a plain mouse wheel moves them
// sideways, a mouse drag across moves them where asked (the click it would have made is eaten), and each row says
// which ends have more beyond them (data-more="start end") for its edge shade (文豪, 2026-11-07, スクロール A).
// Touch keeps the browser's own swipe. A wheel at a row's end, or with Ctrl (zoom), is left to the page.
const DRAG_SHARE = .06; // a drag starts past this share of the row's height

const rowOf = (target, selector) => target?.closest?.(selector) ?? null;
const overflowing = row => row.scrollWidth > row.clientWidth + 1;

// Scroll snapping would pull each small step back to the card it left: it rests while the row is moved, and settles
// the row on a card once it stops.
function pauseSnap(row, timers) {
  row.style.scrollSnapType = 'none';
  clearTimeout(timers.get(row));
  timers.set(row, setTimeout(() => { row.style.scrollSnapType = ''; timers.delete(row); }, 160));
}

export function markRowEnds(row) {
  const max = row.scrollWidth - row.clientWidth;
  const more = max > 1 ? [row.scrollLeft > 1 && 'start', row.scrollLeft < max - 1 && 'end'].filter(Boolean).join(' ') : '';
  if ((row.getAttribute('data-more') ?? '') !== more) row.setAttribute('data-more', more);
}

export function attachRowScroll(root, { selector, drag = null, signal } = {}) {
  const timers = new Map();
  const listen = (type, fn, options) => root.addEventListener?.(type, fn, options);
  const refresh = () => { for (const row of root.querySelectorAll?.(selector) ?? []) markRowEnds(row); };
  listen('wheel', event => {
    const row = rowOf(event.target, selector);
    if (!row || event.ctrlKey || !overflowing(row) || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const step = event.deltaMode === 1 ? row.clientHeight * .1 : event.deltaMode === 2 ? row.clientWidth : 1;
    const delta = event.deltaY * step, max = row.scrollWidth - row.clientWidth;
    if ((delta < 0 && row.scrollLeft <= 0) || (delta > 0 && row.scrollLeft >= max - 1)) return;
    event.preventDefault();
    pauseSnap(row, timers);
    row.scrollLeft += delta;
  }, { passive: false, signal });
  listen('scroll', event => { if (event.target?.matches?.(selector)) markRowEnds(event.target); }, { capture: true, passive: true, signal });
  // A mouse drag across a row (only rows matching drag): touch already swipes, and a pen keeps its taps.
  let press = null, eat = false;
  if (drag) {
    listen('pointerdown', event => {
      const row = event.pointerType === 'mouse' && event.button === 0 ? rowOf(event.target, drag) : null;
      press = row && overflowing(row) ? { row, x: event.clientX, left: row.scrollLeft, moved: false } : null;
    }, { capture: true, signal });
    listen('pointermove', event => {
      if (!press || event.pointerType !== 'mouse') return;
      const dx = event.clientX - press.x;
      if (!press.moved && Math.abs(dx) <= press.row.clientHeight * DRAG_SHARE) return;
      press.moved = true;
      pauseSnap(press.row, timers);
      press.row.scrollLeft = press.left - dx;
    }, { capture: true, signal });
    const end = () => { if (press?.moved) eat = true; press = null; };
    listen('pointerup', end, { capture: true, signal });
    listen('pointercancel', () => { press = null; }, { capture: true, signal });
    // The click that ends a drag is not a press on the card under it.
    listen('click', event => { if (!eat) return; eat = false; event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, signal });
    listen('pointerdown', () => { eat = false; }, { signal });
    // A card's picture would start the browser's own drag of the image.
    listen('dragstart', event => { if (rowOf(event.target, drag)) event.preventDefault(); }, { capture: true, signal });
  }
  // Rows change as cards come and go: their ends are read again after each change.
  let frame = 0;
  const later = globalThis.requestAnimationFrame ?? (fn => setTimeout(fn, 16));
  const observer = typeof MutationObserver === 'function' && root.nodeType === 1 ? new MutationObserver(() => {
    if (frame) return;
    frame = later(() => { frame = 0; refresh(); });
  }) : null;
  observer?.observe(root, { childList: true, subtree: true });
  root.ownerDocument?.defaultView?.addEventListener?.('resize', refresh, { signal });
  signal?.addEventListener?.('abort', () => { observer?.disconnect(); (globalThis.cancelAnimationFrame ?? clearTimeout)(frame); for (const timer of timers.values()) clearTimeout(timer); }, { once: true });
  refresh();
  return Object.freeze({ refresh });
}
