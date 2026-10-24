// Pointer input of a mounted match: long press (card detail or choice peek),
// pulling a hand card up into a drag, swiping the hand down, and board hover.
// A press that turned into something else suppresses its own click.
export function attachSurfacePointer({ root, listener, ui, act, render, latest, schedule, cancel,
  handDrag, handDock, selectionPeek, scenes, queueLayout, suppress }) {
  let press = null;
  const stopPress = () => { if (press) cancel(press.timer); press = null; };
  listener('board-camera-gesture', () => { stopPress(); scenes.clearHover(); });
  listener('board-camera-change', queueLayout);
  listener('pointerover', event => scenes.hover(event.target.closest('[data-wire-hit]')));
  listener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('[data-ability-help]')) return;
    stopPress();
    const choice = event.target.closest('.runtime-selection-option');
    // A peek opened by long press stays until the next touch, which only closes it.
    if (selectionPeek.open() && event.pointerType !== 'mouse') { selectionPeek.hide(); suppress(event.pointerId); return; }
    if (choice) {
      press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, hand: false, timer: null, held: false, cardRef: null };
      press.timer = schedule(() => {
        if (!press) return;
        press.held = true;
        suppress(press.pointerId);
        selectionPeek.show(choice);
      }, 420);
      return;
    }
    const card = event.target.closest('[data-card-ref]');
    const hand = event.target.closest('.r2-hand');
    if (!card && !hand) return;
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, hand: Boolean(hand), timer: null, held: false,
      cardRef: hand && card ? card.dataset.cardRef : null };
    if (card) press.timer = schedule(() => {
      if (!press) return;
      press.held = true;
      suppress(press.pointerId);
      render(ui.selectCard(card.dataset.cardRef, true));
    }, 420);
  });
  listener('pointermove', event => {
    if (handDrag.owns(event.pointerId)) { handDrag.move(event); return; }
    if (!press) return;
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    if (Math.hypot(dx, dy) > 10) cancel(press.timer);
    const value = latest();
    // Pulling a hand card upward picks it up; downward still lowers the hand.
    if (press.hand && press.cardRef && !press.held && dy < -24 && -dy > Math.abs(dx)
      && !value?.plan && !value?.request && !value?.model.requiredInput) {
      const source = event.target.closest?.('[data-card-ref]') ?? root.querySelector(`.r2-hand [data-card-ref="${CSS.escape(press.cardRef)}"]`);
      if (handDrag.start(event, press.cardRef, source)) {
        suppress(event.pointerId);
        stopPress();
        handDock()?.lower();
        // The inspector would cover drop targets; dragging never shows it.
        if (value?.model.ui.detailCardRef) act(ui.closeDetail());
        return;
      }
    }
    if (press.hand && !press.held && value?.model.ui.handOpen && dy > 50 && dy > Math.abs(dx) * 1.2) {
      suppress(press.pointerId);
      stopPress();
      if (handDock()) handDock().lower(); else act(ui.toggleHand());
    }
  });
  listener('pointerup', event => {
    if (handDrag.owns(event.pointerId)) return handDrag.drop(event);
    stopPress();
  });
  listener('pointercancel', event => { if (handDrag.owns(event.pointerId)) handDrag.cancel(); stopPress(); });
  listener('pointerleave', stopPress);
  return Object.freeze({ stopPress, dispose() { press = null; } });
}
