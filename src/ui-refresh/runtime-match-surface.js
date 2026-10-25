import { createMatchUiController } from '../adapters/match-ui-controller.js';
import { runtimeGameHtml, runtimeGameRegions } from './runtime-read-view.js';
import { patchHtml } from './dom-patch.js';
import { isSinglePick } from './choice-read-view.js';
import { validSelectionAnswer } from '../game/runtime/selection-contract.js';
import { selectionStage } from '../adapters/selection-stage.js';
import { syncResultFx } from './result-fx.js';
import { DEFAULT_RENDER_QUALITY } from './wireframe/render-resolution.js';
import { attachHandDock } from './wireframe/hand-dock.js';
import { createSurfaceTimers } from './surface-timers.js';
import { createSurfaceLayout } from './surface-layout.js';
import { patchRegion, syncInteractionClasses, localRegionKeys, createLogSync } from './surface-regions.js';
import { createSurfaceScenes } from './surface-scenes.js';
import { createSurfaceFx } from './surface-fx.js';
import { routeClick } from './surface-clicks.js';
import { createSurfaceOpponents } from './surface-opponents.js';
import { attachSurfacePointer } from './surface-pointer.js';
import { createHandDrag } from './hand-drag.js';
import { attachSelectionPeek } from './selection-peek.js';
import { attachCountPeek } from './count-peek.js';
import { attachDetailScroll } from './detail-scroll.js';
import { centerIncidentStrip } from './user-detail-view.js';

// One delegated input surface, one session. This module cannot reach the engine
// and has no legacy fallback. Host owns title/deck/settings and session changes.
// It wires the parts together; each surface-*.js module owns one concern.
export function mountRuntimeMatch({ root, session, viewerSeat, view = 'pc', aiSeat = null,
  onTitle = () => {}, onRematch = () => {}, onMenu = null, onError = () => {},
  onTutorialSkip = () => {}, onTutorialComplete = () => {}, effectsEnabled = false, tapDetails = false, boardStyle = 'wireframe', renderQuality = DEFAULT_RENDER_QUALITY, lowGpu = false }) {
  const created = createMatchUiController({ session, viewerSeat });
  if (!created.ok) return created;
  const ui = created.value;
  const lifetime = new AbortController();
  let disposed = false;
  let latest = null;
  let suppressedPointerId = null;
  let handDock = null;
  let handRequestId = null;
  // Only hand-card options keep the hand up while a request is open.
  const requestUsesHand = value => {
    const hand = value?.model.seats.find(seat => seat.seatId === value.model.match.viewerSeat)?.hand.cards;
    const refs = new Set((Array.isArray(hand) ? hand : []).map(card => card.cardRef));
    return Boolean(value?.request?.options.some(option => refs.has(option.cardRef)));
  };
  let renderScope = null;
  let regionKeys = new Map();
  let opponents = null;
  const scope = session.scope();
  const current = () => !disposed && session.scope().matchId === scope.matchId && session.scope().sessionGeneration === scope.sessionGeneration;
  const fx = createSurfaceFx({ root, boardStyle });
  const timers = createSurfaceTimers({ root, disposed: () => disposed, motionRemaining: fx.remaining });
  const { schedule } = timers;
  const surfaceLayout = createSurfaceLayout({ root, session, scope, boardStyle, latest: () => latest,
    requestFrame: timers.requestFrame, disposed: () => disposed });
  const queueLayout = surfaceLayout.queue;
  const scenes = createSurfaceScenes({ root, boardStyle, renderQuality, latest: () => latest, lowGpu });
  const log = createLogSync(root);
  const render = result => {
    if (disposed) return;
    if (!result.ok) { onError(result.error.code); return; }
    const next = result.value;
    const tutorial = session.tutorial();
    const presentation = { ...next, view, effectsEnabled, boardStyle, tutorial:tutorial.ok ? tutorial.value : null };
    const nextScope = `${next.model.match.matchId}:${next.sync?.sessionGeneration ?? scope.sessionGeneration}:${next.model.match.viewerSeat}:${next.model.match.revision}:${next.sync?.modeEpoch ?? 0}:${view}:${effectsEnabled ? 1 : 0}`;
    // Decorative work (anchors, scenes, effects) may fail without stopping the match,
    // and its failure must not keep the events from being handed over: they would be
    // replayed and fail again on every later render.
    const decorate = (work, fallback) => {
      try { return work(); }
      catch (error) { console.debug('[decoration]', error); onError('RUNTIME_DECORATION_FAILED'); return fallback; }
    };
    const anchors = decorate(() => fx.capture(next, effectsEnabled, handDrag.flyOrigin()),
      { priorAnchors: new Map(), priorBoardAnchors: null, priorMotion: null });
    try {
      const shell = root.querySelector('.r2-runtime-view');
      const shellRebuilt = !shell || shell.dataset.layout !== (view === 'mobile' ? 'mobile' : 'desktop');
      const nextKeys = localRegionKeys(next,tutorial.ok ? tutorial.value : null);
      const changedLocal = [...nextKeys].filter(([name,key]) => regionKeys.get(name) !== key).map(([name]) => name);
      const runtimeChanged = renderScope !== nextScope;
      if (shellRebuilt) {
        patchHtml(root, runtimeGameHtml(next.model, presentation));
      } else {
        const regions = runtimeGameRegions(next.model, presentation, { includeRuntime: runtimeChanged, includeLocal: changedLocal });
        if (runtimeChanged) for (const name of ['board', 'console', 'hand', 'hand-toggle']) patchRegion(root, name, regions[name === 'hand-toggle' ? 'handToggle' : name]);
        for (const name of changedLocal) {
          patchRegion(root, name, regions[name]);
        }
        if (changedLocal.includes('profile')) centerIncidentStrip(root);
        root.querySelector('.r2-runtime-view').dataset.revision = String(next.model.match.revision);
      }
      if (JSON.stringify(latest?.zoneView) !== JSON.stringify(next.zoneView)) {
        const list=root.querySelector('.wf-drawer .admin-card-list');
        if(list)list.scrollTop=0;
      }
      log.sync(next,shellRebuilt);
      handDock?.sync();
      // A new request puts the hand away: a raised hand covers the lit slots and the confirm
      // bar. It can be raised again, and stays up while a hand-card pick is being made.
      const requestId = next.request?.requestId ?? null;
      if (requestId !== null && requestId !== handRequestId) handDock?.away();
      handRequestId = requestId;
      const geometryDirty = shellRebuilt || runtimeChanged
        || latest?.model.ui.handOpen !== next.model.ui.handOpen
        || changedLocal.some(name => ['drawer','detail','art','guide','popup','selection','result'].includes(name));
      if (runtimeChanged || changedLocal.includes('selection')) scenes.dropHover();
      latest = next;
      renderScope = nextScope;
      regionKeys = nextKeys;
      syncInteractionClasses(root, next);
      decorate(() => scenes.sync(next, effectsEnabled, shellRebuilt || runtimeChanged));
      if (geometryDirty) queueLayout();
      decorate(() => syncResultFx(root,effectsEnabled && !lowGpu));
      decorate(() => fx.play(next, anchors, effectsEnabled));
      const ids = next.events.map(event => event.eventId);
      if (ids.length) {
        const acknowledged = ui.ackEvents(ids);
        if (!acknowledged.ok) onError(acknowledged.error.code);
      }
    } catch (error) {
      onError(error?.message ?? 'RUNTIME_RENDER_FAILED');
      return;
    }
    selectionPeek.hideIfDetached();
    if (tutorial.ok && tutorial.value.flow.complete && latest.model.requiredInput === null) schedule(() => {if (current()) onTutorialComplete();},0);
    if (latest.eventReadError) onError(latest.eventReadError);
  };
  // A step that is already decided needs no confirm: a single pick (board or list,
  // draft or required choice) answers its request, and a finished plan is submitted.
  const settle = result => {
    for (let step = 0; step < 8 && result.ok && (result.value.plan || result.value.request); step++) {
      const { plan, request, selection } = result.value;
      // An optional single pick is never decided by its empty starting answer.
      // A staged pick is decided once its last group has a pick.
      const stage = request && selectionStage(request, selection);
      const decided = request ? (stage ? stage.index === stage.total : isSinglePick(request) && selection?.optionIds?.length === 1)
        && validSelectionAnswer(request, selection)
        : Boolean(plan.completion);
      if (!decided) break;
      result = ui.confirm();
    }
    return result;
  };
  const act = result => {
    result = settle(result);
    render(result);
    if (!disposed && result.ok) opponents?.startCpu(latest);
    if (!disposed && result.ok) opponents?.startTutorial();
  };
  const listener = (type, handler) => root.addEventListener(type, handler, { signal: lifetime.signal });
  // Both boards raise the hand the same way; only the look differs.
  handDock = attachHandDock(root, {
    busy: () => requestUsesHand(latest), changed: queueLayout
  });
  const handDrag = createHandDrag({ root, ui, act, latest: () => latest, schedule });
  const clicks = { ui, act, session, boardStyle, latest: () => latest, tapDetails: () => tapDetails,
    onTitle, onTutorialSkip, onRematch, onMenu, onError };
  listener('click', event => {
    if (disposed || event.target.closest('[data-ability-help]')) return;
    if (suppressedPointerId !== null) {
      if (event.pointerId === undefined || event.pointerId === suppressedPointerId) {
        suppressedPointerId = null;
        return;
      }
    }
    return routeClick(event, clicks);
  });
  listener('input', event => {
    if (event.target.hasAttribute('data-allocation-option')) act(ui.setAmount(
      event.target.dataset.allocationOption, Number(event.target.value)
    ));
  });
  const selectionPeek = attachSelectionPeek({ root, listener });
  attachCountPeek({ root, listener, signal: lifetime.signal });
  attachDetailScroll({ root, signal: lifetime.signal });
  const pointer = attachSurfacePointer({ root, listener, ui, act, render, latest: () => latest,
    schedule, cancel: timers.cancel, handDrag, handDock: () => handDock, selectionPeek, scenes, queueLayout,
    suppress: pointerId => { suppressedPointerId = pointerId; } });
  listener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-wire-hit]')) {
      event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click',{bubbles:true})); return;
    }
    if (event.key !== 'Escape') return;
    if (latest?.model.ui.logOpen) act(ui.toggleLog());
    else act(ui.back());
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(queueLayout) : null;
  observer?.observe(root);
  // Anchors move when a scrolled list, an image or a font settles; all of them share the one queued layout.
  const inScroller = target => target?.matches?.('.admin-card-list,.r2-hand-scroll');
  root.addEventListener('scroll', event => { if (latest?.model.ui.selectedCardRef && inScroller(event.target)) queueLayout(); },
    { capture: true, passive: true, signal: lifetime.signal });
  root.addEventListener('load', event => { if (event.target?.tagName === 'IMG') queueLayout(); },
    { capture: true, signal: lifetime.signal });
  root.ownerDocument?.fonts?.addEventListener?.('loadingdone', queueLayout, { signal: lifetime.signal });
  const sides = createSurfaceOpponents({ session, scope, aiSeat, ui, paced: timers.paced, cancelPaced: timers.cancelPaced,
    current, onError, render });
  if (!sides.ok) { lifetime.abort(); observer?.disconnect(); handDock?.dispose(); ui.dispose(); return sides; }
  opponents = sides.value;
  const surface = Object.freeze({
    refresh() { const read = ui.read(); render(read); opponents.startCpu(latest); opponents.startTutorial(); return read; },
    configure(options) { if (options.view) view = options.view; if (typeof options.effectsEnabled === 'boolean') effectsEnabled = options.effectsEnabled; if (typeof options.tapDetails === 'boolean') tapDetails = options.tapDetails; return this.refresh(); },
    startAi() { return opponents.startAi(); },
    switchViewer(seatId) { pointer.stopPress(); fx.clear(); const read = ui.switchViewer(seatId); render(read); return read; },
    dispose() {
      if (!disposed) {
        disposed = true; handDrag.dispose(); selectionPeek.hide(); lifetime.abort(); observer?.disconnect(); scenes.dispose();
        fx.dispose();
        handDock?.dispose();handDock=null;
        timers.clear(); surfaceLayout.dispose(); opponents.dispose(); ui.dispose(); syncResultFx(root,false); latest = null; pointer.dispose();
        regionKeys.clear(); log.reset();
      }
      return { ok: true, value: null };
    }
  });
  session.track(surface);
  surface.refresh();
  opponents.startCpu(latest);
  return { ok: true, value: surface };
}
