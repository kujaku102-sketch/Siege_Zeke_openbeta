import { flow } from '../adapters/match-ui-controller.js';
import { fxMs } from './fx-speed.js';
import { openingPhase } from './opening-view.js';

// The opening screen's side of a mounted match (opening-view.js draws it): the cards marked to return, the cards just
// drawn by a redraw (they come in with a short drop, effects on and not compat), the redraws made, and the dice's answer
// shown for a moment once the opening is over. A card is marked by a tap or by dragging it up past a quarter of its height.
const FIRST_MS = 2400;
const FRESH_MS = 900;
const LIFT = .25;

const handRefs = model => model.seats.find(seat => seat.seatId === model.match.viewerSeat)?.hand.cards.map(card => card.cardRef) ?? [];

export function createOpeningInput({ root, ui, act, latest, schedule, motion }) {
  let marks = new Set(), fresh = new Set(), used = 0, first = null, opening = false, lifted = null, press = null;
  const redraw = () => act(ui.read());

  // Each read, before it is drawn: the marks still in hand, and the dice's answer as the opening ends.
  function observe(next) {
    const phase = openingPhase(next.model);
    if (phase) opening = true;
    else if (opening) {
      opening = false;
      marks.clear();
      // The first turn's start names who won the dice; the active seat says the same if its event was handed over already.
      first = next.events.find(event => event.type === 'turn_started')?.actorSeat ?? next.model.match.activeSeat;
      schedule(() => { first = null; redraw(); }, fxMs(FIRST_MS));
    }
    const hand = new Set(handRefs(next.model));
    for (const ref of marks) if (!hand.has(ref)) marks.delete(ref);
    return { marks: [...marks], fresh: motion() ? [...fresh].filter(ref => hand.has(ref)) : [], used, first };
  }

  function toggle(ref) {
    // The click that ends a drag up is not a second toggle.
    if (lifted === ref) { lifted = null; return; }
    if (marks.has(ref)) marks.delete(ref); else marks.add(ref);
    redraw();
  }

  // The one button: keep with nothing marked, else redraw the marked cards (the pick answered here, then the move sent).
  function decide() {
    const read = latest(), phase = read && openingPhase(read.model);
    if (phase?.phase !== 'mine') return;
    if (!marks.size || !phase.redrawId) return act(ui.chooseAction(phase.keepId));
    const before = new Set(handRefs(read.model)), chosen = [...marks];
    return act(flow(function* () {
      let result = yield ui.chooseAction(phase.redrawId);
      for (const ref of chosen) {
        if (!result.ok) return result;
        const option = result.value.request?.options.find(item => item.cardRef === ref);
        if (option) result = yield ui.toggleOption(option.optionId);
      }
      if (!result.ok) return result;
      result = yield ui.confirm();
      if (result.ok && result.value.plan?.completion) result = yield ui.confirm();
      if (result.ok) {
        used += 1;
        marks.clear();
        fresh = new Set(handRefs(result.value.model).filter(ref => !before.has(ref)));
        schedule(() => { fresh.clear(); redraw(); }, fxMs(FRESH_MS));
      }
      return result;
    }()));
  }

  // Dragging a card up marks it; it follows the finger until let go.
  const card = event => event.target.closest?.('[data-opening-card]');
  const listen = (type, handler) => root.addEventListener(type, handler);
  const onDown = event => { const node = card(event); if (node && event.button === 0) { lifted = null; press = { node, id: event.pointerId, y: event.clientY }; } };
  const onMove = event => {
    if (!press || event.pointerId !== press.id) return;
    const rise = Math.min(0, event.clientY - press.y);
    press.node.style.setProperty('--opening-drag', `${rise}px`);
  };
  const onUp = event => {
    if (!press || event.pointerId !== press.id) return;
    const { node, y } = press;
    press = null;
    node.style.removeProperty('--opening-drag');
    const ref = node.dataset.openingCard;
    if (y - event.clientY > node.getBoundingClientRect().height * LIFT) {
      lifted = ref;
      if (!marks.has(ref)) { marks.add(ref); redraw(); }
    }
  };
  const onCancel = () => { if (press) press.node.style.removeProperty('--opening-drag'); press = null; };
  listen('pointerdown', onDown);
  listen('pointermove', onMove);
  listen('pointerup', onUp);
  listen('pointercancel', onCancel);
  return Object.freeze({ observe, toggle, decide,
    dispose() { for (const [type, handler] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel]]) root.removeEventListener(type, handler); } });
}
