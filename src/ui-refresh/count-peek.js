// The count button works while held: pressing it marks the root, and every count tag
// on the board shows; letting go anywhere hides them again. Keyboard holds work too.
export function attachCountPeek({ root, listener, signal }) {
  const show = () => root.setAttribute?.('data-count-peek', '');
  const hide = () => root.removeAttribute?.('data-count-peek');
  listener('pointerdown', event => { if (event.button === 0 && event.target.closest('[data-runtime-counts]')) show(); });
  // Letting go outside the match still counts, so the release is watched on the window.
  const win = root.ownerDocument?.defaultView;
  for (const type of ['pointerup', 'pointercancel', 'blur']) (win ?? root).addEventListener?.(type, hide, { signal });
  listener('keydown', event => { if ((event.key === ' ' || event.key === 'Enter') && event.target.closest('[data-runtime-counts]')) { event.preventDefault(); show(); } });
  listener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') hide(); });
  listener('contextmenu', event => { if (event.target.closest('[data-runtime-counts]')) event.preventDefault(); });
  signal.addEventListener('abort', hide);
}
