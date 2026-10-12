import { createMatchUiController } from '../adapters/match-ui-controller.js';
import { createRuntimeClientController } from '../adapters/runtime-client-controller.js';
import { chooseSimpleAiIntent } from '../adapters/simple-ai-policy.js';
import { runtimeGameHtml } from './runtime-read-view.js';
import { patchHtml } from './dom-patch.js';
import { fitBoard, placePopup, avoidFocus } from './model.js';
import { fitGuideContent } from './guide.js';
import { createTutorialOpponentController } from '../adapters/tutorial-opponent-controller.js';
import { syncResultFx } from './result-fx.js';
import { applyRuntimeVisualEvents } from '../ui/visual-effects.js';

// One delegated input surface, one session. This module cannot reach the engine
// and has no legacy fallback. Host owns title/deck/settings and session changes.
export function mountRuntimeMatch({ root, session, viewerSeat, view = 'pc', aiSeat = null,
  onTitle = () => {}, onRematch = () => {}, onMenu = null, onError = () => {},
  onTutorialSkip = () => {}, onTutorialComplete = () => {}, effectsEnabled = false, tapDetails = false }) {
  const created = createMatchUiController({ session, viewerSeat });
  if (!created.ok) return created;
  const ui = created.value;
  const lifetime = new AbortController();
  let disposed = false;
  let latest = null;
  let press = null;
  let suppressClickUntil = 0;
  let cpu = null;
  let tutorialCpu = null;
  const scope = session.scope();
  const current = () => !disposed && session.scope().matchId === scope.matchId && session.scope().sessionGeneration === scope.sessionGeneration;
  const timers = new Set();
  const schedule = (task, delay) => {
    const token = setTimeout(() => { timers.delete(token); if (!disposed) task(); }, delay);
    timers.add(token);
    return token;
  };
  const cancel = token => { clearTimeout(token); timers.delete(token); };
  const layout = () => {
    const stage = root.querySelector('.r2-stage'), board = root.querySelector('.r2-board');
    const canvas = root.querySelector('.r2-board-fit'), contents = root.querySelector('.battle-board');
    if (stage && board && canvas && contents) {
      const size = fitBoard(stage.clientWidth, stage.clientHeight);
      board.style.width = `${size.width}px`; board.style.height = `${size.height}px`;
      const height = Math.max(1, contents.offsetHeight);
      canvas.style.height = `${height}px`;
      canvas.style.transform = `translate(-50%, -50%) scale(${Math.min(size.width / 1000, size.height / height)})`;
    }
    const popup = root.querySelector('.r2-popup');
    const selected = latest?.model.ui.selectedCardRef;
    const anchor = selected && [...root.querySelectorAll('.card[data-card-ref]')]
      .find(node => node.dataset.cardRef === selected);
    if (popup && anchor) {
      const viewport = root.getBoundingClientRect();
      const position = placePopup(anchor.getBoundingClientRect(), popup.getBoundingClientRect(), viewport);
      popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
    }
    const tutorial = session.tutorial();
    if (tutorial.ok && !tutorial.value.flow.complete) for (const focus of tutorial.value.presentation.focus ?? []) {
      const seat = scope.seatIds[focus.owner === 'ai' ? 1 : 0];
      const selectors = {card:`[data-card-id="${focus.cardId}"][data-seat="${seat}"][data-zone="${focus.zone}"]`,
        zone:`.zone[data-seat="${seat}"][data-zone="${focus.zone}"]`,fortress:`[data-fortress="${seat}"]`,
        admin:`[data-runtime-zone="${focus.zone}"][data-seat="${seat}"]`,action:focus.action === 'tutorial-advance' ? '[data-runtime-tutorial-next]' : '[data-runtime-end-turn]'};
      for (const element of root.querySelectorAll(selectors[focus.kind] ?? ':not(*)')) {
        element.classList.add('live-focus');element.dataset.tutorialFocusLabel = focus.label;
      }
    }
    const guide = root.querySelector('.live-guide');
    if (guide) {
      const viewport = {left:0,top:0,width:root.ownerDocument.documentElement.clientWidth,height:root.ownerDocument.documentElement.clientHeight};
      fitGuideContent(guide,viewport);
      const targets = [...root.querySelectorAll('.live-focus,.r2-detail,.r2-console,.r2-popup')].map(element => element.getBoundingClientRect());
      const position = avoidFocus(guide.getBoundingClientRect(),targets,viewport);
      guide.style.left = `${position.left}px`;guide.style.top = `${position.top}px`;
    }
  };
  const render = result => {
    if (disposed) return;
    if (!result.ok) { onError(result.error.code); return; }
    latest = result.value;
    const tutorial = session.tutorial();
    patchHtml(root, runtimeGameHtml(latest.model, { ...latest, view, effectsEnabled, tutorial:tutorial.ok ? tutorial.value : null }));
    layout();
    syncResultFx(root,effectsEnabled);
    if (effectsEnabled) { try { applyRuntimeVisualEvents(root,latest.events,latest.model); } catch { /* decorative failures do not affect commands */ } }
    if (tutorial.ok && tutorial.value.flow.complete && latest.model.requiredInput === null) schedule(() => {if (current()) onTutorialComplete();},0);
    if (latest.eventReadError) onError(latest.eventReadError);
  };
  const act = result => {
    render(result);
    if (!disposed && result.ok) cpu?.start();
    if (!disposed && result.ok) tutorialCpu?.start();
  };
  const listener = (type, handler) => root.addEventListener(type, handler, { signal: lifetime.signal });
  listener('click', event => {
    if (disposed || Date.now() < suppressClickUntil || event.target.closest('[data-ability-help]')) return;
    const target = event.target.closest('button');
    if (!target) {
      if (event.target.closest('.r2-board') && !latest?.request) act(ui.back());
      return;
    }
    if (target.hasAttribute('data-runtime-title')) return onTitle();
    if (target.hasAttribute('data-runtime-tutorial-skip')) return onTutorialSkip();
    if (target.hasAttribute('data-runtime-tutorial-next')) { const next = session.advanceTutorial(); return next.ok ? act(ui.read()) : onError(next.error.code); }
    if (target.hasAttribute('data-runtime-unique')) return act(ui.openUnique(target.dataset.runtimeUnique));
    if (target.hasAttribute('data-runtime-unique-close')) return act(ui.closeUnique());
    if (target.hasAttribute('data-runtime-art')) return act(ui.openArt(target.dataset.runtimeArt));
    if (target.hasAttribute('data-runtime-art-close')) return act(ui.closeArt());
    if (target.hasAttribute('data-runtime-result-close')) return act(ui.dismissResult());
    if (target.hasAttribute('data-runtime-rematch')) return onRematch();
    if (target.hasAttribute('data-runtime-menu')) return onMenu ? onMenu() : act(ui.toggleMenu());
    if (target.hasAttribute('data-runtime-zone')) return act(ui.openZone(target.dataset.seat, target.dataset.runtimeZone));
    if (target.hasAttribute('data-runtime-zone-close')) return act(ui.closeZone());
    if (target.hasAttribute('data-option-id')) return act(ui.toggleOption(target.dataset.optionId));
    if (target.hasAttribute('data-runtime-confirm')) return act(ui.confirm());
    if (target.hasAttribute('data-runtime-decline')) return act(ui.decline());
    if (target.hasAttribute('data-runtime-back')) return act(ui.back());
    if (target.hasAttribute('data-runtime-hand')) return act(ui.toggleHand());
    if (target.hasAttribute('data-runtime-log')) return act(ui.toggleLog());
    if (target.hasAttribute('data-selection-collapse')) return act(ui.toggleCollapsed());
    if (target.hasAttribute('data-close-detail')) return act(ui.closeDetail());
    if (target.hasAttribute('data-action-id')) return act(ui.chooseAction(target.dataset.actionId));
    if (target.hasAttribute('data-card-ref')) {
      const option = latest?.request?.options.find(option => option.cardRef === target.dataset.cardRef);
      return act(option ? ui.toggleOption(option.optionId) : ui.selectCard(target.dataset.cardRef,tapDetails));
    }
  });
  listener('input', event => {
    if (event.target.hasAttribute('data-allocation-option')) act(ui.setAmount(
      event.target.dataset.allocationOption, Number(event.target.value)
    ));
  });
  const stopPress = () => { if (press) cancel(press.timer); press = null; };
  listener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('[data-ability-help]')) return;
    stopPress();
    const card = event.target.closest('[data-card-ref]');
    const hand = event.target.closest('.r2-hand');
    if (!card && !hand) return;
    press = { x: event.clientX, y: event.clientY, hand: Boolean(hand), timer: null, held: false };
    if (card) press.timer = schedule(() => {
      if (!press) return;
      press.held = true;
      suppressClickUntil = Date.now() + 600;
      render(ui.selectCard(card.dataset.cardRef, true));
    }, 420);
  });
  listener('pointermove', event => {
    if (!press) return;
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    if (Math.hypot(dx, dy) > 10) cancel(press.timer);
    if (press.hand && !press.held && latest?.model.ui.handOpen && dy > 50 && dy > Math.abs(dx) * 1.2) {
      suppressClickUntil = Date.now() + 400;
      stopPress(); act(ui.toggleHand());
    }
  });
  listener('pointerup', stopPress);
  listener('pointercancel', stopPress);
  listener('pointerleave', stopPress);
  listener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (latest?.model.ui.logOpen) act(ui.toggleLog());
    else act(ui.back());
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
  observer?.observe(root);
  if (aiSeat !== null) {
    const port = session.port(aiSeat);
    if (!port.ok) { lifetime.abort(); observer?.disconnect(); ui.dispose(); return port; }
    const controller = createRuntimeClientController({ port: port.value, policy: chooseSimpleAiIntent,
      scheduler: { schedule: task => schedule(() => { task(); render(ui.read()); }, 420), cancel } });
    if (!controller.ok) { lifetime.abort(); observer?.disconnect(); ui.dispose(); return controller; }
    cpu = controller.value;
  }
  if (session.tutorial().ok) {
    const opponent = createTutorialOpponentController({session,seatId:scope.seatIds[1],scheduler:{
      schedule:task => schedule(() => { if (!current()) return; task(); render(ui.read()); },420),cancel
    }});
    if (!opponent.ok) {lifetime.abort();observer?.disconnect();ui.dispose();return opponent;}
    tutorialCpu = opponent.value;
  }
  const surface = Object.freeze({
    refresh() { const read = ui.read(); render(read); tutorialCpu?.start(); return read; },
    configure(options) { if (options.view) view = options.view; if (typeof options.effectsEnabled === 'boolean') effectsEnabled = options.effectsEnabled; if (typeof options.tapDetails === 'boolean') tapDetails = options.tapDetails; return this.refresh(); },
    startAi() { return cpu?.start() ?? { ok: true, value: { kind: 'idle' } }; },
    switchViewer(seatId) { stopPress(); const read = ui.switchViewer(seatId); render(read); return read; },
    dispose() {
      if (!disposed) {
        disposed = true; lifetime.abort(); observer?.disconnect();
        for (const timer of timers) clearTimeout(timer);
        timers.clear(); cpu?.dispose(); tutorialCpu?.dispose(); ui.dispose(); syncResultFx(root,false); latest = null; press = null;
      }
      return { ok: true, value: null };
    }
  });
  session.track(surface);
  surface.refresh();
  cpu?.start();
  return { ok: true, value: surface };
}
