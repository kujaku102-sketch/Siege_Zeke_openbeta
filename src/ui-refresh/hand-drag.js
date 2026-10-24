import { resolveInteractionTarget } from '../adapters/interaction-targets.js';
import { actionBlock, blockMessage, actionTypeOf, handCard } from './runtime-read-view.js';

const ghostAt = (ghost, event) => {
  ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -60%) scale(.62)`;
};

// Hand drag for a mounted match. The surface decides when a press becomes a drag;
// this module owns the ghost, the hover mark, the drop and its rejection.
export function createHandDrag({ root, ui, act, latest, schedule }) {
  let drag = null;
  let flyOrigin = null;
  // Hand drag: the drop point picks the action. Each candidate is planned (a query,
  // never a submit) and kept only when its first request accepts the dropped-on target.
  const dropHits = node => {
    const card = node.closest('[data-card-ref]:not(.r2-hand [data-card-ref])');
    const slot = node.closest('.board-slot[data-seat][data-zone][data-slot]');
    const fortress = node.closest('[data-fortress]');
    return [card && { kind: 'card', cardRef: card.dataset.cardRef },
      slot && { kind: 'slot', seatId: slot.dataset.seat, zone: slot.dataset.zone, slot: Number(slot.dataset.slot) },
      fortress && { kind: 'user', seatId: fortress.dataset.fortress }].filter(Boolean);
  };
  // Returns the runtime block (or a misplaced-drop block) when the drop cannot start anything.
  const dropOn = (cardRef, node) => {
    const model = latest()?.model;
    const card = model && handCard(model, cardRef);
    if (!card || !node) return null;
    const actions = card.interaction.sourceActionIds.map(id => model.legalActions.find(action => action.actionId === id)).filter(Boolean);
    const registry = node.closest('[data-runtime-zone="registry"]');
    if (registry) {
      if (registry.dataset.seat !== model.match.viewerSeat) return MISPLACED;
      const install = actions.filter(action => actionTypeOf(action) === 'install');
      if (!install.length) return actionBlock(model, cardRef, 'install') ?? {};
      act(install.length === 1 ? ui.chooseAction(install[0].actionId) : ui.selectCard(cardRef));
      return null;
    }
    if (!node.closest('.r2-board')) return null;
    const hits = dropHits(node), matches = [];
    for (const action of actions.filter(action => action.kind !== 'fixed')) {
      const planned = ui.chooseAction(action.actionId);
      const hit = planned.ok && planned.value.interactionRequest
        && hits.find(item => resolveInteractionTarget(planned.value.interactionRequest, item).kind === 'one');
      if (hit) matches.push({ action, hit });
      ui.back();
    }
    if (matches.length === 1) {
      const chosen = ui.chooseAction(matches[0].action.actionId);
      act(chosen.ok ? ui.hitTarget(matches[0].hit) : chosen);
      return null;
    }
    if (matches.length > 1) { act(ui.selectCard(cardRef)); return null; }
    // A spell has no board position; dropping it anywhere on the board casts it.
    const spell = actions.filter(action => actionTypeOf(action) === 'executeSpell');
    if (spell.length === 1) { act(ui.chooseAction(spell[0].actionId)); return null; }
    const playable = actions.some(action => action.kind !== 'fixed');
    return playable ? MISPLACED
      : actionBlock(model, cardRef, card.definition.category === 'Sp' ? 'executeSpell' : 'executeCard') ?? {};
  };
  const MISPLACED = { message: 'そこには置けません' };
  let rejectDialog = null;
  const reject = (ghost, block) => {
    const reason = block.message ?? blockMessage(block);
    // A missing symbol points at its own lamp above the registry.
    if (block.code === 'SYMBOL_MISSING') for (const lamp of root.querySelectorAll(`[data-symbol-seat="${CSS.escape(latest()?.model.match.viewerSeat ?? '')}"] [data-symbol="${CSS.escape(block.symbol ?? '')}"]`)) {
      lamp.classList.remove('blink'); void lamp.getBoundingClientRect(); lamp.classList.add('blink');
      schedule(() => lamp.classList.remove('blink'), 1300);
    }
    ghost.hidden = false;
    ghost.classList.add('rejected');
    schedule(() => ghost.remove(), 420);
    rejectDialog?.remove();
    const dialog = root.ownerDocument.createElement('div');
    dialog.className = 'drop-reject-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.textContent = reason;
    root.ownerDocument.body.append(dialog);
    rejectDialog = dialog;
    schedule(() => { dialog.remove(); if (rejectDialog === dialog) rejectDialog = null; }, 1800);
  };
  // Open panels may float over the board; the drop goes to what lies beneath them.
  const dropNodeAt = (x, y) => root.ownerDocument.elementsFromPoint(x, y)
    .find(node => node.closest('.r2-board,[data-runtime-zone="registry"]')) ?? null;
  const endDrag = drop => {
    if (!drag) return;
    const { cardRef, ghost, over, rect } = drag;
    drag = null;
    over?.classList.remove('drag-over');
    root.classList.remove('hand-dragging');
    flyOrigin = drop && rect ? { cardRef, rect } : null;
    let reason;
    try { reason = drop ? dropOn(cardRef, drop) : null; } finally { flyOrigin = null; }
    if (reason) reject(ghost, reason); else ghost.remove();
  };
  return Object.freeze({
    owns: pointerId => Boolean(drag) && pointerId === drag.pointerId,
    // Where a dropped card leaves from while its drop is being acted on.
    flyOrigin: () => flyOrigin,
    start(event, cardRef, source) {
      const ghost = source?.cloneNode(true);
      if (!ghost) return false;
      ghost.classList.add('hand-drag-ghost');
      ghostAt(ghost, event);
      root.ownerDocument.body.append(ghost);
      drag = { pointerId: event.pointerId, cardRef, ghost, over: null };
      root.classList.add('hand-dragging');
      try { root.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
      return true;
    },
    move(event) {
      ghostAt(drag.ghost, event);
      const over = dropNodeAt(event.clientX, event.clientY)?.closest('[data-wire-hit],.board-slot,[data-runtime-zone]') ?? null;
      if (over !== drag.over) { drag.over?.classList.remove('drag-over'); over?.classList.add('drag-over'); drag.over = over; }
    },
    drop(event) {
      const { left, top, width, height } = drag.ghost.getBoundingClientRect();
      drag.rect = width && height ? { left, top, width, height } : null;
      drag.ghost.hidden = true;
      endDrag(dropNodeAt(event.clientX, event.clientY));
    },
    cancel: () => endDrag(null),
    dispose() { endDrag(null); rejectDialog?.remove(); }
  });
}
