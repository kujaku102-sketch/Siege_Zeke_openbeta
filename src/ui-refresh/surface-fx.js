import { applyRuntimeVisualEvents } from '../ui/visual-effects.js';
import { captureBattleAnchors, createBattleFx } from './wireframe/battle-fx.js';
import { captureMotionAnchors, createMotionFx } from './motion-fx.js';
import { runtimeActivationHtml, activationSide, runtimeThreadItemHtml } from './runtime-log-view.js';
import { activeTurnCount } from './wireframe/controls-view.js';
import { createMemoryFlash } from './wireframe/memory-meter.js';
import { createImpactFx } from './impact-fx.js';

const THREAD_DONE_MS = 400, THREAD_STEP_MS = 150;
const CALLOUT_MS = 2000, CALLOUT_LEAVE_MS = 400, CALLOUT_CLOSE_MS = 250, CALLOUT_MAX = 4;

// Card activations from both sides, named like their log rows, in one stack at the
// top left under the opponent's hand, oldest on top. Each row stays for CALLOUT_MS,
// slides left as it fades, and the rows below move up to close the gap. Without
// effects a row just goes. Never takes input.
// While a trigger thread resolves, all of its triggers are listed in the stack with
// Trn on their left; the one being processed is solid, the rest see-through.
// Each trigger's row goes as soon as it has resolved (when the next one starts, or the
// thread ends), a beat later and one after another if several finish together.
function createActivationCallout(root) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis, timers = new Set();
  let stack = null;
  const threads = new Map();
  const later = (fn, ms) => { const id = win.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  // A re-render drops nodes it did not write; while rows are up, put the stacks straight back.
  const watcher = typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => {
    const view = root.querySelector('.r2-runtime-view');
    if (!stack?.childElementCount) { watcher.disconnect(); return; }
    if (view && stack.parentNode !== view) view.append(stack);
  }) : null;
  const host = () => {
    const view = root.querySelector('.r2-runtime-view');
    if (!view) return null;
    // The same node is kept across re-renders (the patch drops nodes it did not write), so a stack survives them.
    if (!stack) {
      stack = doc.createElement('div');
      stack.className = 'r2-activation';
      stack.setAttribute('aria-live', 'polite');
    }
    if (stack.parentNode !== view) view.append(stack);
    watcher?.observe(root, { childList: true, subtree: true });
    return stack;
  };
  const leave = (item, animate) => {
    if (!item.isConnected || item.classList.contains('is-leaving')) return;
    item.classList.add('is-leaving');
    if (!animate) { item.remove(); return; }
    later(() => {
      // Fold the row away so the rest slide over to fill its place.
      item.style.height = `${item.offsetHeight}px`;
      void item.offsetHeight;
      item.classList.add('is-closing');
      item.style.height = '0px';
      later(() => item.remove(), CALLOUT_CLOSE_MS);
    }, CALLOUT_LEAVE_MS);
  };
  const hide = () => { for (const id of timers) win.clearTimeout(id); timers.clear(); watcher?.disconnect(); threads.clear(); stack?.replaceChildren(); };
  return Object.freeze({
    show(events, viewerSeat, effectsEnabled = false) {
      const animate = Boolean(effectsEnabled) && !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      let finished = 0;
      const done = (group, id) => {
        const item = group.rows.get(id);
        if (!item) return;
        group.rows.delete(id);
        later(() => leave(item, animate), THREAD_DONE_MS + finished++ * THREAD_STEP_MS);
      };
      for (const event of events) {
        if (event.type === 'thread_started') {
          const node = host();
          if (!node) return;
          const rows = new Map();
          (event.items ?? []).forEach((entry, index) => {
            const item = doc.createElement('div');
            item.className = `r2-activation-item is-thread${animate ? ' is-animated' : ''}`;
            item.innerHTML = runtimeThreadItemHtml(entry, index + 1, viewerSeat);
            node.append(item);
            rows.set(entry.threadItemId, item);
          });
          threads.set(event.threadId, { rows, current: null });
          continue;
        }
        if (event.type === 'thread_resolved') {
          const group = threads.get(event.threadId);
          threads.delete(event.threadId);
          // The last one processed goes first, then any that never ran.
          if (group?.current) done(group, group.current);
          for (const id of [...(group?.rows.keys() ?? [])]) done(group, id);
          continue;
        }
        const group = event.threadItemId && threads.get(event.threadId);
        if (group && group.current !== event.threadItemId && group.rows.has(event.threadItemId)) {
          if (group.current) done(group, group.current);
          group.current = event.threadItemId;
          for (const [id, item] of group.rows) item.classList.toggle('is-current', id === event.threadItemId);
        }
        const html = activationSide(event, viewerSeat) && runtimeActivationHtml(event, viewerSeat);
        if (!html) continue;
        const node = host();
        if (!node) return;
        const item = doc.createElement('div');
        item.className = `r2-activation-item${animate ? ' is-animated' : ''}`;
        item.innerHTML = html;
        node.append(item);
        // Too many at once: the oldest make way early. Small screens hold fewer (--callout-max).
        const max = Number(win.getComputedStyle?.(node).getPropertyValue('--callout-max')) || CALLOUT_MAX;
        // Thread rows are never pushed out; they go when their thread resolves.
        const staying = [...node.children].filter(child => !child.classList.contains('is-leaving') && !child.classList.contains('is-thread'));
        staying.slice(0, Math.max(0, staying.length - max)).forEach(old => leave(old, animate));
        later(() => leave(item, animate), CALLOUT_MS);
      }
    },
    hide
  });
}

// Effects of a mounted match. capture() records where things were before a
// re-render; play() then animates the new events from those places.
export function createSurfaceFx({ root, boardStyle }) {
  let battleFx = null;
  let motion = null;
  const callout = createActivationCallout(root);
  const memoryFlash = createMemoryFlash(root);
  const impact = createImpactFx(root);
  return Object.freeze({
    capture(next, effectsEnabled, flyOrigin) {
      const priorAnchors = new Map();
      const priorBoardAnchors = boardStyle === 'wireframe' ? captureBattleAnchors(root) : null;
      const priorMotion = effectsEnabled && next.events.length ? captureMotionAnchors(root) : null;
      // A dropped card leaves from where it was let go, not from the hand.
      if (priorMotion && flyOrigin) priorMotion.cards.set(flyOrigin.cardRef, flyOrigin.rect);
      for (const event of next.events) for (const ref of [event.source?.cardRef, event.target?.cardRef].filter(Boolean)) {
        const node = [...root.querySelectorAll('[data-card-ref]')].find(item => item.dataset.cardRef === ref);
        const rect = node?.getBoundingClientRect();
        if (rect?.width && rect?.height) priorAnchors.set(ref, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }
      return { priorAnchors, priorBoardAnchors, priorMotion };
    },
    play(next, { priorAnchors, priorBoardAnchors, priorMotion }, effectsEnabled) {
      callout.show(next.events, next.model.match.viewerSeat, effectsEnabled);
      try { memoryFlash.play(next.model, effectsEnabled); } catch { /* decorative */ }
      if (!effectsEnabled) { battleFx?.clear(); motion?.flush(); impact.clear(); }
      if (effectsEnabled && next.events.length) {
        try {
          const moves = next.events.filter(event => event.type === 'card_moved');
          const others = next.events.filter(event => event.type !== 'card_moved');
          const shown = events => {
            if (boardStyle !== 'wireframe') applyRuntimeVisualEvents(root,events,next.model,priorAnchors);
            else {
              battleFx ??= createBattleFx(root);
              battleFx.play(events,priorBoardAnchors);
              applyRuntimeVisualEvents(root,events.filter(event => event.type === 'user_ability_feedback'),next.model,priorAnchors);
            }
            // Last, so a hit stop also freezes the numbers and rings just drawn.
            impact.play(events,next.model);
          };
          motion ??= createMotionFx(root);
          motion.play(next.events,priorMotion,next.model.match.viewerSeat,{ impact:() => shown(others), landed:() => shown(moves), turnCount:activeTurnCount(next.model) });
        }
        catch { /* decorative failure is an explicit handled disposition */ }
      }
    },
    remaining: () => motion?.remaining() ?? 0,
    clear() { battleFx?.clear(); motion?.flush(); impact.clear(); callout.hide(); },
    dispose() { callout.hide(); memoryFlash.dispose(); impact.dispose(); battleFx?.dispose();battleFx=null;motion?.dispose();motion=null; }
  });
}
