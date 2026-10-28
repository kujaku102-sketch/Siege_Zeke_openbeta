import { resolveInteractionTarget } from '../adapters/interaction-targets.js';
import { isBoardPick } from './choice-read-view.js';
import { blockMessage } from './runtime-read-view.js';

// Buttons that do one thing whatever the game state. Order matters: the first
// attribute the clicked button carries wins.
const BUTTONS = [
  ['data-runtime-title', c => c.onTitle()],
  ['data-runtime-tutorial-skip', c => c.onTutorialSkip()],
  ['data-runtime-tutorial-finish', c => c.onTutorialComplete()],
  ['data-runtime-guide-next', c => c.turnGuidePage(1)],
  ['data-runtime-guide-prev', c => c.turnGuidePage(-1)],
  // The tried play moves the step on and its reason shows in the guide for that step (not a shell notice).
  ['data-tutorial-try', (c, target) => { const next = c.session.advanceTutorial(); if (!next.ok) return c.onError(next.error.code); c.noteTutorial(blockMessage({ code: target.dataset.tutorialTry })); return c.act(c.ui.read()); }],
  ['data-runtime-tutorial-next', c => { const next = c.session.advanceTutorial(); return next.ok ? c.act(c.ui.read()) : c.onError(next.error.code); }],
  ['data-runtime-unique-close', c => c.act(c.ui.closeUnique())],
  ['data-runtime-profile-close', c => c.act(c.ui.closeProfile())],
  ['data-runtime-art', (c, target) => c.act(c.ui.openArt(target.dataset.runtimeArt))],
  ['data-runtime-art-close', c => c.act(c.ui.closeArt())],
  ['data-runtime-result-close', c => c.act(c.ui.dismissResult())],
  ['data-runtime-rematch', c => c.onRematch()],
  ['data-runtime-menu', c => c.onMenu ? c.onMenu() : c.act(c.ui.toggleMenu())],
  // Held, not clicked: count-peek.js shows the counts while it is down.
  ['data-runtime-counts', () => {}],
  ['data-runtime-zone', (c, target) => c.act(c.ui.openZone(target.dataset.seat, target.dataset.runtimeZone))],
  ['data-runtime-zone-close', c => c.act(c.ui.closeZone())],
  ['data-option-id', (c, target) => c.act(c.ui.toggleOption(target.dataset.optionId))],
  ['data-runtime-confirm', c => c.act(c.ui.confirm())],
  ['data-runtime-decline', c => c.act(c.ui.decline())],
  ['data-runtime-back', c => c.act(c.ui.back())],
  ['data-runtime-hand', c => c.act(c.ui.toggleHand())],
  ['data-runtime-log', c => c.act(c.ui.toggleLog())],
  ['data-selection-collapse', c => c.act(c.ui.toggleCollapsed())],
  ['data-close-detail', c => c.act(c.ui.closeDetail())]
];

const slotHit = slot => ({ kind: 'slot', seatId: slot.dataset.seat, zone: slot.dataset.zone, slot: Number(slot.dataset.slot) });

// Routes one click to a UI command. `c` carries the surface's callbacks and reads.
export function routeClick(event, c) {
  const { ui, act } = c;
  const latest = c.latest();
  // A tap on the guide's line, not on one of its buttons (runtime-match-surface.js, tapGuide).
  if (event.target.closest('.live-guide-speech') && !event.target.closest('button')) return c.tapGuide?.();
  const target =event.target.closest('button') ?? (c.boardStyle === 'wireframe' ? event.target.closest('[data-wire-hit]') : null);
  if (!target) {
    if (latest?.interactionRequest) {
      const slot = event.target.closest('.board-slot[data-seat][data-zone][data-slot]');
      if (slot) return act(ui.hitTarget(slotHit(slot)));
    }
    if (event.target.closest('.r2-board') && !latest?.request) act(ui.back());
    return;
  }
  const button = BUTTONS.find(([attribute]) => target.hasAttribute(attribute));
  if (button) return button[1](c, target);
  if (latest?.interactionRequest) {
    const card = target.closest('[data-card-ref]');
    const fortress = target.closest('[data-fortress]');
    const slot = target.closest('.board-slot[data-seat][data-zone][data-slot]');
    // A placed card sits in its slot: the tap may mean the card or the slot, so the one the
    // current request lists wins (an occupied slot is a legal destination, e.g. a layered stack).
    const hits = [card && { kind: 'card', cardRef: card.dataset.cardRef },
      fortress && { kind: 'user', seatId: fortress.dataset.fortress }, slot && slotHit(slot)].filter(Boolean);
    const hit = hits.find(item => resolveInteractionTarget(latest.interactionRequest, item).kind !== 'none') ?? hits[0] ?? null;
    // A board pick is answered on the board only. Hand cards and anything that is not
    // a lit target are ignored, so they can neither open a popup nor raise an error.
    if (hit && latest.request && (isBoardPick(latest.request, latest.interactionRequest) || latest.stage)
      && (!target.closest('[data-live-region="board"]') || resolveInteractionTarget(latest.interactionRequest, hit).kind === 'none')) return;
    if (hit) return act(ui.hitTarget(hit));
  }
  if (target.hasAttribute('data-runtime-unique')) return act(ui.openUnique(target.dataset.runtimeUnique));
  // The user window and area show the user's profile, but not while a choice is being made.
  if (target.hasAttribute('data-runtime-profile')) return latest?.request ? undefined : act(ui.openProfile(target.dataset.runtimeProfile));
  if (target.hasAttribute('data-action-id')) return act(ui.chooseAction(target.dataset.actionId));
  if (target.hasAttribute('data-card-ref')) {
    const option = latest?.request?.options.find(option => option.cardRef === target.dataset.cardRef);
    return act(option ? ui.toggleOption(option.optionId) : ui.selectCard(target.dataset.cardRef,c.tapDetails()));
  }
  if (target.hasAttribute('data-wire-hit') && !latest?.request) return act(ui.back());
}
