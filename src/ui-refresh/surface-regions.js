import { patchHtml } from './dom-patch.js';
import { runtimeLogHtml, runtimeLogBodyHtml } from './runtime-log-view.js';

// Region-level DOM updates of a mounted match: which local regions changed,
// patching one region, the selection/target marks and the open log.
export const patchRegion = (root, name, html) => {
  const host = root.querySelector(`[data-live-region="${name}"]`);
  if (!host) throw new Error(`MISSING_RUNTIME_REGION_${name}`);
  patchHtml(host, html);
};

export const syncInteractionClasses = (root, value) => {
  const selected = value.model.ui.selectedCardRef;
  for (const node of root.querySelectorAll('[data-card-ref]')) {
    node.classList.toggle('selected', node.dataset.cardRef === selected);
    node.classList.remove('request-target');
  }
  for (const node of root.querySelectorAll('.board-slot,[data-fortress]')) node.classList.remove('request-target');
  for (const option of value.interactionRequest?.options ?? []) for (const target of option.targets) {
    const nodes = target.kind === 'card' ? root.querySelectorAll('[data-card-ref]')
      : target.kind === 'user' ? root.querySelectorAll('[data-fortress]')
      : root.querySelectorAll('.board-slot[data-seat][data-zone][data-slot]');
    for (const node of nodes) {
      const matches = target.kind === 'card' ? node.dataset.cardRef === target.cardRef
        : target.kind === 'user' ? node.dataset.fortress === target.seatId
        : node.dataset.seat === target.seatId && node.dataset.zone === target.zone
          && Number(node.dataset.slot) === target.slot;
      if (matches) node.classList.add('request-target');
    }
  }
};

// A local region is redrawn only when its key changes.
export const localRegionKeys = (value, tutorial) => {
  const revision = value.model.match.revision;
  const json = item => JSON.stringify(item ?? null);
  return new Map([
    ['drawer', json([revision,value.zoneView])],
    ['detail', json([revision,value.model.ui.detailCardRef,value.inspection])],
    ['unique', json([revision,value.uniqueSeat])],
    ['profile', json([revision,value.profileSeat])],
    ['art', json([revision,value.artRef])],
    ['guide', json([value.sync?.modeEpoch ?? 0,tutorial])],
    ['popup', json([revision,value.model.ui.selectedCardRef,Boolean(value.plan || value.request)])],
    ['selection', json([revision,value.request,value.selection,value.collapsed,value.plan?.completion])],
    ['menu', String(value.model.ui.menuOpen)],
    ['result', json([revision,value.resultDismissed])]
  ]);
};

export function createLogSync(root) {
  let logState = { open: false, ids: new Set(), previousTurn: null };
  const sync = (value, shellRebuilt) => {
    const open = value.model.ui.logOpen;
    const viewer = value.model.match.viewerSeat;
    const lastTurn = value.log.at(-1)?.turnNumber ?? null;
    if (shellRebuilt) {
      logState = { open, ids: new Set(value.log.map(event => event.eventId)), previousTurn: lastTurn };
      return;
    }
    if (!open) {
      if (logState.open) patchRegion(root,'log','');
      logState = { open: false, ids: new Set(), previousTurn: null };
      return;
    }
    if (!logState.open) {
      patchRegion(root,'log',runtimeLogHtml(value.log,viewer));
      logState = { open: true, ids: new Set(value.log.map(event => event.eventId)), previousTurn: lastTurn };
      return;
    }
    const host = root.querySelector('[data-live-region="log"]');
    const scroll = host?.querySelector('.r2-log-scroll');
    if (!scroll) {
      patchRegion(root,'log',runtimeLogHtml(value.log,viewer));
      logState = { open: true, ids: new Set(value.log.map(event => event.eventId)), previousTurn: lastTurn };
      return;
    }
    const present = new Set([...scroll.querySelectorAll('[data-event-id]')].map(node => node.dataset.eventId));
    const missing = value.log.filter(event => !logState.ids.has(event.eventId) && !present.has(event.eventId));
    if (!missing.length) return;
    // New rows can join an earlier command or close a thread box, so the body is redrawn whole.
    const top = scroll.scrollTop;
    scroll.innerHTML = runtimeLogBodyHtml(value.log,viewer,new Set(missing.map(event => event.eventId)));
    scroll.scrollTop = top;
    logState = { open: true, ids: new Set([...logState.ids,...missing.map(event => event.eventId)]), previousTurn: lastTurn };
  };
  return Object.freeze({ sync, reset() { logState = { open:false,ids:new Set(),previousTurn:null }; } });
}
