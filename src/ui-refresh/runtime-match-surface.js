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
import { GUIDE_MAX_LINES, splitGuidePages } from './guide-pages.js';
import { createGuideLineCounter } from './guide.js';
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
  onTutorialSkip = () => {}, onTutorialComplete = () => {}, onNoticeClear = () => {}, effectsEnabled = false, tapDetails = false, boardStyle = 'wireframe', renderQuality = DEFAULT_RENDER_QUALITY, lowGpu = false, onContextLost = () => {} }) {
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
  // A notice raised by a press in a tutorial stays while the player is on that step and clears once the
  // guide moves past it (a refused move can be retried; a passed step leaves no stale reason behind).
  let noticeStep = null;
  const tutorialIndex = () => { const tutorial = session.tutorial(); return tutorial.ok ? tutorial.value.flow.index : null; };
  const reportError = code => { noticeStep = tutorialIndex(); onError(code); };
  // A line the surface adds under the guide's text for one step (the reason a tried play failed).
  let tutorialNote = null;
  const noteTutorial = text => { const index = tutorialIndex(); tutorialNote = index === null ? null : { index, text }; };
  // Guide pages (guide-pages.js): cut per screen by the layout (paginateGuide), turned by [次へ]/[戻る] or the
  // arrow keys. Until the last page of a step its highlights stay off and the match does not take input.
  let guidePaging = { key: null, pages: null }, guidePage = { step: null, index: 0 }, guidePageShown = null, fontEpoch = 0;
  const pageStep = flow => `${flow.tutorialId}:${flow.complete ? 'done' : flow.introComplete ? flow.index : 'intro:' + flow.introIndex}`;
  const pageFor = value => {
    const presentation = value.presentation;
    if (!presentation || presentation.parts) return null;
    const step = pageStep(value.flow);
    if (guidePage.step !== step) guidePage = { step, index: 0 };
    const pages = guidePaging.key?.startsWith(`${presentation.text}\u0000`) ? guidePaging.pages : null;
    if (!pages) return { index: 0, count: 1, text: presentation.text, last: false, pending: true };
    const index = Math.min(guidePage.index, pages.length - 1);
    return { index, count: pages.length, text: pages[index].text, last: index === pages.length - 1, pending: false };
  };
  const tutorialView = () => {
    const tutorial = session.tutorial();
    if (!tutorial.ok) { guidePageShown = null; return tutorial; }
    const page = pageFor(tutorial.value);
    guidePageShown = page;
    const note = tutorialNote?.index === tutorial.value.flow.index ? { note: tutorialNote.text } : {};
    return { ok: true, value: { ...tutorial.value, ...note, ...(page ? { page } : {}) } };
  };
  const paginateGuide = guide => {
    const tutorial = session.tutorial(), presentation = tutorial.ok ? tutorial.value.presentation : null;
    if (!presentation || presentation.parts) return;
    const counter = createGuideLineCounter(guide);
    if (!counter) return;
    try {
      const maxLines = Math.min(GUIDE_MAX_LINES, counter.lines);
      const key = `${presentation.text}\u0000${counter.width}\u0000${maxLines}\u0000${fontEpoch}`;
      if (guidePaging.key === key) return;
      guidePaging = { key, pages: splitGuidePages(presentation.text, { lineCount: counter.count, maxLines }) };
      schedule(() => { if (!disposed) render(ui.read()); }, 0);
    } finally { counter.dispose(); }
  };
  const turnGuidePage = delta => {
    const shown = guidePageShown;
    if (!shown || shown.pending) return;
    const index = Math.max(0, Math.min(shown.count - 1, shown.index + delta));
    if (index === shown.index) return;
    const focused = root.ownerDocument.activeElement?.closest?.('.live-guide');
    guidePage = { ...guidePage, index };
    act(ui.read());
    // Keep the keyboard on the button pressed: back stays on [戻る] until the first page, otherwise [次へ].
    const forward = '.live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next],[data-runtime-tutorial-finish])';
    if (focused) (root.querySelector(delta < 0 && index > 0 ? '.live-guide [data-runtime-guide-prev]' : forward) ?? root.querySelector(forward))?.focus();
  };
  const fx = createSurfaceFx({ root, boardStyle });
  const timers = createSurfaceTimers({ root, disposed: () => disposed, motionRemaining: fx.remaining });
  const { schedule } = timers;
  const surfaceLayout = createSurfaceLayout({ root, session, scope, boardStyle, latest: () => latest,
    requestFrame: timers.requestFrame, disposed: () => disposed,
    guideLastPage: () => !guidePageShown || guidePageShown.last, paginateGuide: guide => paginateGuide(guide),
    guideStep: () => guidePage.step });
  const queueLayout = surfaceLayout.queue;
  const scenes = createSurfaceScenes({ root, boardStyle, renderQuality, latest: () => latest, lowGpu,
    onContextLost: () => { if (!disposed) onContextLost(); } });
  const log = createLogSync(root);
  const render = result => {
    if (disposed) return;
    // A move the tutorial refused is redrawn as it stands, so the guide shows why.
    if (!result.ok) { reportError(result.error.code); if (String(result.error.code).startsWith('TUTORIAL_') && result.error.code !== 'TUTORIAL_DISPOSED') { const read = ui.read(); if (read.ok) render(read); } return; }
    const next = result.value;
    const tutorial = tutorialView();
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
      // Reading a step's earlier pages: the match waits for its last page.
      const reading = Boolean(guidePageShown && !guidePageShown.last);
      for (const name of ['board', 'console', 'hand', 'hand-toggle']) { const host = root.querySelector(`[data-live-region="${name}"]`); if (host) host.inert = reading; }
      root.querySelector('.r2-runtime-view')?.classList.toggle('tutorial-reading', reading);
      // Compat render mode: the guide drops its backdrop blur (heavy on WebKit) and keeps an opaque face.
      root.querySelector('.r2-runtime-view')?.classList.toggle('live-low-gpu', lowGpu);
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
    if (noticeStep !== null && tutorial.ok && tutorial.value.flow.index > noticeStep) { noticeStep = null; onNoticeClear(); }
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
    onTitle, onTutorialSkip, onTutorialComplete, onRematch, onMenu, onError: reportError, noteTutorial, turnGuidePage };
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
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && event.target.closest?.('.live-guide')) {
      event.preventDefault(); turnGuidePage(event.key === 'ArrowRight' ? 1 : -1); return;
    }
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
  root.ownerDocument?.fonts?.addEventListener?.('loadingdone', () => { fontEpoch += 1; queueLayout(); }, { signal: lifetime.signal });
  const sides = createSurfaceOpponents({ session, scope, aiSeat, ui, paced: timers.paced, cancelPaced: timers.cancelPaced,
    current, onError, render });
  if (!sides.ok) { lifetime.abort(); observer?.disconnect(); handDock?.dispose(); ui.dispose(); return sides; }
  opponents = sides.value;
  const surface = Object.freeze({
    refresh() { const read = ui.read(); render(read); opponents.startCpu(latest); opponents.startTutorial(); return read; },
    configure(options) { if (options.renderQuality) scenes.setRenderQuality(options.renderQuality); if (typeof options.lowGpu === 'boolean') { lowGpu = options.lowGpu; scenes.setLowGpu(lowGpu); } if (options.view) view = options.view; if (typeof options.effectsEnabled === 'boolean') effectsEnabled = options.effectsEnabled; if (typeof options.tapDetails === 'boolean') tapDetails = options.tapDetails; return this.refresh(); },
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
