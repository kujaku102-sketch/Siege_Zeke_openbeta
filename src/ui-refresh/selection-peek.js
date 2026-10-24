// Choice-card peek: the hidden full text of one option, floated beside it.
// Mouse hover and keyboard focus open it here; the surface opens it on long press.
export function attachSelectionPeek({ root, listener }) {
  let peek = null, peekOwner = null;
  const hidePeek = () => { peek?.remove(); peek = null; peekOwner = null; };
  const showPeek = option => {
    const source = option?.querySelector('.selection-peek-source');
    if (!source) return;
    if (peekOwner === option && peek) return;
    hidePeek();
    const doc = root.ownerDocument;
    peek = doc.createElement('div');
    peek.className = 'selection-peek';
    peek.setAttribute('role', 'tooltip');
    peek.innerHTML = source.innerHTML;
    doc.body.append(peek);
    peekOwner = option;
    // Beside the dialog when there is room, so the other choices stay visible.
    const at = option.getBoundingClientRect(), size = peek.getBoundingClientRect();
    const box = option.closest('.effect-dialog')?.getBoundingClientRect() ?? at;
    const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight, gap = 8;
    const beside = box.right + gap + size.width <= width - gap ? box.right + gap
      : box.left - gap - size.width >= gap ? box.left - gap - size.width : null;
    let left = beside ?? at.left + at.width / 2 - size.width / 2;
    let top = beside === null ? at.bottom + gap : at.top;
    if (top + size.height > height - gap) top = beside === null && at.top - gap - size.height >= gap ? at.top - gap - size.height : height - gap - size.height;
    left = Math.min(Math.max(gap, left), width - gap - size.width);
    peek.style.left = `${left}px`; peek.style.top = `${Math.max(gap, top)}px`;
  };
  listener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const option = event.target.closest('.runtime-selection-option');
    if (option) showPeek(option); else if (peek) hidePeek();
  });
  listener('focusin', event => { const option = event.target.closest('.runtime-selection-option'); if (option) showPeek(option); });
  listener('focusout', event => { if (peekOwner && !peekOwner.contains(event.relatedTarget)) hidePeek(); });
  return Object.freeze({
    show: showPeek,
    hide: hidePeek,
    open: () => Boolean(peek),
    // A re-render can drop the option the peek belongs to.
    hideIfDetached() { if (peekOwner && !peekOwner.isConnected) hidePeek(); }
  });
}
