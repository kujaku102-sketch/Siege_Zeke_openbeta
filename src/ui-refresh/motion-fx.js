import { CARD_ART } from '../data/card-art.generated.js';

// Presentation only: one move's public events played as beats (impact, turn
// banner, card flights). Never blocks input; the next move fast-forwards it.
export const MOTION = Object.freeze({ impact: 600, banner: 700, fly: 460, budget: 1200 });
const CARD_SELECTOR = '[data-live-region="board"] [data-card-ref],[data-live-region="hand"] [data-card-ref]';
const RECT_KEYS = ['left', 'top', 'width', 'height'];
const valid = r => r && RECT_KEYS.every(key => Number.isFinite(r[key])) && r.width > 0 && r.height > 0;
const copy = r => ({ left: r.left, top: r.top, width: r.width, height: r.height });
const clip = (r, view) => {
  const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
  const right = Math.min(r.left + r.width, view.width), bottom = Math.min(r.top + r.height, view.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
};
const quote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export function captureMotionAnchors(root) {
  const doc = root.ownerDocument;
  const view = { width: doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0,
    height: doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0 };
  const cards = new Map(), zones = new Map(), lit = new Map();
  for (const node of root.querySelectorAll(CARD_SELECTOR)) {
    const ref = node.dataset.cardRef, r = node.getBoundingClientRect();
    // A card in a lowered hand has a position but no visible face.
    if (!cards.has(ref) && valid(r) && clip(r, view)) cards.set(ref, copy(r));
  }
  const zone = (seat, name, node) => {
    const r = node && clip(node.getBoundingClientRect(), view);
    if (seat && valid(r) && !zones.has(`${seat}:${name}`)) zones.set(`${seat}:${name}`, r);
  };
  for (const node of root.querySelectorAll('[data-runtime-zone][data-seat]')) zone(node.dataset.seat, node.dataset.runtimeZone, node);
  for (const node of root.querySelectorAll('[data-fx-zone][data-fx-seat]')) zone(node.dataset.fxSeat, node.dataset.fxZone, node);
  const hand = root.querySelector('[data-live-region="hand"]:not([hidden])');
  const handRect = hand && clip(hand.getBoundingClientRect(), view);
  if (valid(handRect)) zones.set('viewer:hand', handRect);
  for (const group of root.querySelectorAll('[data-symbol-seat]'))
    lit.set(group.dataset.symbolSeat, new Set([...group.querySelectorAll('.symbol-lamp.lit')].map(lamp => lamp.dataset.symbol)));
  return { cards, zones, lit };
}

const center = r => [r.left + r.width / 2, r.top + r.height / 2];
const around = (r, width, height) => {
  const [x, y] = center(r);
  return { left: x - width / 2, top: y - height / 2, width, height };
};
// A zone is a pile or tray, not a card: the flight shrinks into its middle.
const fitInto = (zone, card) => {
  const scale = Math.min(.6, zone.width * .8 / card.width, zone.height * .8 / card.height);
  return around(zone, card.width * scale, card.height * scale);
};

function zoneRect(anchors, seat, name, viewerSeat) {
  if (name === 'hand' && seat === viewerSeat && valid(anchors.zones.get('viewer:hand'))) return anchors.zones.get('viewer:hand');
  return anchors.zones.get(`${seat}:${name}`) ?? null;
}
function locate(location, ref, anchors, viewerSeat) {
  if (!location || location.kind === 'unobserved') return null;
  const exact = ref && anchors.cards.get(ref);
  if (exact) return { rect: exact, exact: true };
  if (location.kind === 'mounted') {
    const host = anchors.cards.get(location.hostRef);
    return host ? { rect: host, exact: false } : null;
  }
  if (location.kind === 'zone') {
    const rect = zoneRect(anchors, location.seatId, location.zone, viewerSeat);
    return rect ? { rect, exact: false } : null;
  }
  return null;
}

// Pure: what flies where, and which beats a batch needs.
export function planMotion(events, before, after, viewerSeat) {
  const flights = [];
  for (const event of events) {
    if (event.type !== 'card_moved' || !event.target || event.to?.kind === 'unobserved') continue;
    const to = locate(event.to, event.target.cardRef, after, viewerSeat);
    let from = locate(event.from, event.source?.cardRef, before, viewerSeat);
    // Unseen before: a draw comes off the deck, an opponent's card out of their hand.
    if (!from && event.from?.kind === 'unobserved') {
      const seat = event.to.seatId ?? event.actorSeat;
      const drawn = event.to.kind === 'zone' && event.to.zone === 'hand';
      const rect = zoneRect(before, seat, drawn || seat === viewerSeat ? 'deck' : 'hand', viewerSeat);
      from = rect ? { rect, exact: false } : null;
    }
    if (!from || !to) continue;
    const size = from.exact ? from.rect : to.exact ? to.rect : { width: 60, height: 84 };
    const start = from.exact ? from.rect : fitInto(from.rect, size);
    const end = to.exact ? to.rect : fitInto(to.rect, size);
    if (RECT_KEYS.every(key => Math.abs(start[key] - end[key]) < 2)) continue;
    flights.push({ ref: event.target.cardRef, from: start, to: end, landsOnCard: to.exact,
      faceDown: event.target.faceDown, definitionId: event.target.definitionId ?? null, name: event.target.name ?? '',
      seat: event.to.seatId ?? null, zone: event.to.zone ?? event.to.kind });
  }
  const turn = events.findLast(event => event.type === 'turn_started') ?? null;
  const impact = events.some(event => ['attack_declared', 'card_damaged', 'user_damaged', 'card_destroyed'].includes(event.type));
  return { flights, turn: turn && { seat: turn.actorSeat, turnNumber: turn.turnNumber, mine: turn.actorSeat === viewerSeat }, impact };
}

// Beats run in order and share one budget; a long batch is compressed, never cut.
// The banner counts the new turn from its own side ("their 3rd turn"), like the TURN
// button; the match-wide number from the event is only a fallback.
export function bannerTurn(turn, turnCount) {
  return turn && { ...turn, turnNumber: Number.isSafeInteger(turnCount) && turnCount > 0 ? turnCount : turn.turnNumber };
}

export function motionTimeline(plan, durations = MOTION) {
  const beats = [plan.impact ? durations.impact : 0, plan.turn ? durations.banner : 0, plan.flights.length ? durations.fly : 0];
  const total = beats.reduce((sum, value) => sum + value, 0);
  const scale = total > durations.budget ? durations.budget / total : 1;
  const [impact, banner, fly] = beats.map(value => Math.round(value * scale));
  return { impactAt: 0, bannerAt: impact, bannerFor: banner, flyAt: impact + banner, flyFor: fly, end: impact + banner + fly };
}

export function createMotionFx(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const reduced = () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const timers = new Set(), animations = new Set(), rules = new Map();
  let layer = null, sheet = null, frame = null, endsAt = 0, disposed = false;
  const later = (task, delay) => {
    const timer = win.setTimeout(() => { timers.delete(timer); if (!disposed) { try { task(); } catch { /* decorative */ } } }, delay);
    timers.add(timer);
  };
  // Rules live outside the patched tree, so a re-render cannot drop a hidden or blinking state.
  const syncRules = () => {
    if (!rules.size) { sheet?.remove(); sheet = null; return; }
    if (!sheet) { sheet = doc.createElement('style'); sheet.dataset.fxMotion = ''; doc.head.append(sheet); }
    sheet.textContent = [...rules.values()].join('\n');
  };
  const rule = (key, css, duration = null) => {
    rules.set(key, css); syncRules();
    if (duration !== null) later(() => { rules.delete(key); syncRules(); }, duration);
  };
  const ensureLayer = () => {
    if (layer) return layer;
    layer = doc.createElement('div');
    layer.className = 'fx-motion-layer'; layer.setAttribute('aria-hidden', 'true');
    doc.body.append(layer);
    return layer;
  };
  const animate = (node, frames, options) => {
    if (!node.animate) return;
    const animation = node.animate(frames, options);
    animations.add(animation);
    animation.finished?.then(() => animations.delete(animation), () => animations.delete(animation));
  };
  const cardSelector = ref => `[data-live-region="board"] [data-card-ref=${quote(ref)}],[data-live-region="hand"] [data-card-ref=${quote(ref)}]`;
  const zoneSelector = (seat, zone) => `[data-runtime-zone=${quote(zone)}][data-seat=${quote(seat)}],[data-fx-zone=${quote(zone)}][data-fx-seat=${quote(seat)}]`;
  const flush = () => {
    for (const timer of timers) win.clearTimeout(timer);
    timers.clear();
    if (frame !== null) win.cancelAnimationFrame?.(frame);
    frame = null;
    for (const animation of animations) animation.cancel();
    animations.clear(); rules.clear(); syncRules();
    layer?.remove(); layer = null; endsAt = 0;
  };
  const banner = (turn, duration, still) => {
    const node = doc.createElement('div');
    node.className = `fx-turn-banner ${turn.mine ? 'mine' : 'enemy'}`;
    node.innerHTML = `<small>TURN ${Number(turn.turnNumber) || ''}</small><strong>${turn.mine ? 'YOUR TURN' : 'ENEMY TURN'}</strong>`;
    ensureLayer().append(node);
    animate(node, still
      ? [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .8 }, { opacity: 0 }]
      : [{ opacity: 0, transform: 'translate(-50%,-50%) translateX(-18vw) skewX(-12deg)' },
        { opacity: 1, transform: 'translate(-50%,-50%)', offset: .25 },
        { opacity: 1, transform: 'translate(-50%,-50%)', offset: .75 },
        { opacity: 0, transform: 'translate(-50%,-50%) translateX(18vw) skewX(-12deg)' }],
    { duration, easing: 'ease-in-out', fill: 'forwards' });
    later(() => node.remove(), duration);
    if (!still) rule('turn-spin', `.wf-turn{animation:fx-turn-spin ${duration}ms ease-in-out}`, duration);
  };
  const fly = (flight, duration) => {
    const node = doc.createElement('div');
    const art = !flight.faceDown && flight.definitionId && CARD_ART[flight.definitionId];
    node.className = `fx-fly-card${flight.faceDown ? ' face-down' : ''}`;
    if (art) { const image = doc.createElement('img'); image.src = art; image.alt = ''; node.append(image); }
    else if (!flight.faceDown && flight.name) { const caption = doc.createElement('span'); caption.textContent = flight.name; node.append(caption); }
    Object.assign(node.style, { left: `${flight.to.left}px`, top: `${flight.to.top}px`, width: `${flight.to.width}px`, height: `${flight.to.height}px` });
    ensureLayer().append(node);
    const [fx, fy] = center(flight.from), [tx, ty] = center(flight.to);
    const sx = flight.from.width / flight.to.width, sy = flight.from.height / flight.to.height;
    const lift = Math.min(90, Math.hypot(tx - fx, ty - fy) * .18);
    animate(node, [
      { transform: `translate(${fx - tx}px,${fy - ty}px) scale(${sx},${sy})` },
      { transform: `translate(${(fx - tx) / 2}px,${(fy - ty) / 2 - lift}px) scale(${(sx + 1) / 2},${(sy + 1) / 2})`, offset: .5 },
      { transform: 'translate(0,0) scale(1,1)' }
    ], { duration, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' });
    later(() => node.remove(), duration);
  };
  const lampSelector = (seat, symbol) => `[data-symbol-seat=${quote(seat)}] [data-symbol=${quote(symbol)}]`;
  // A lamp lit by an install stays dark until its card lands, then flashes.
  const flashLamps = (seat, symbols) => {
    for (const symbol of symbols) {
      rules.delete(`unlit:${seat}:${symbol}`);
      rule(`lamp:${seat}:${symbol}`, `${lampSelector(seat, symbol)}{animation:fx-lamp-flash 900ms ease-out}`, 900);
    }
    if (!symbols.length) rule(`land:${seat}:registry`, `${zoneSelector(seat, 'registry')}{animation:fx-zone-land 600ms ease-out}`, 600);
    else syncRules();
  };
  const now = () => win.performance?.now() ?? Date.now();
  // impact(): hits and breaks; landed(): what happens once cards are in place.
  const play = (events, before, viewerSeat, { impact = () => {}, landed = () => {}, turnCount = null } = {}) => {
    flush();
    if (disposed || !before || !events.length) { impact(); landed(); return 0; }
    const still = reduced();
    // Hide arrivals and new lamps at once; where they fly from is measured a frame
    // later, once the patched board has been laid out.
    const arriving = events.filter(event => event.type === 'card_moved' && event.target && event.to?.kind !== 'unobserved');
    const installs = new Map();
    for (const event of arriving) if (event.to.zone === 'registry' && event.to.seatId) {
      const lit = [...root.querySelectorAll(`[data-symbol-seat=${quote(event.to.seatId)}] .symbol-lamp.lit`)].map(lamp => lamp.dataset.symbol);
      installs.set(event.to.seatId, lit.filter(symbol => !before.lit.get(event.to.seatId)?.has(symbol)));
    }
    if (!still) {
      for (const event of arriving) rule(`hide:${event.target.cardRef}`, `${cardSelector(event.target.cardRef)}{visibility:hidden!important}`);
      for (const [seat, symbols] of installs) for (const symbol of symbols)
        rule(`unlit:${seat}:${symbol}`, `${lampSelector(seat, symbol)}{visibility:hidden!important}\n[data-count-peek] ${lampSelector(seat, symbol)}{visibility:visible!important}\n${lampSelector(seat, symbol)} circle{fill:none!important;opacity:.55!important;filter:none!important}`);
    }
    const guess = motionTimeline({ impact: planMotion(events, before, before, viewerSeat).impact,
      turn: events.some(event => event.type === 'turn_started'), flights: arriving });
    endsAt = now() + guess.end + 32;
    const start = () => {
      frame = null;
      if (disposed) return;
      const plan = planMotion(events, before, captureMotionAnchors(root), viewerSeat);
      const time = motionTimeline(plan);
      try { impact(); } catch { /* decorative */ }
      if (plan.turn) later(() => banner(bannerTurn(plan.turn, turnCount), time.bannerFor, still), time.bannerAt);
      const flying = new Set();
      for (const flight of plan.flights) {
        const target = flight.landsOnCard ? cardSelector(flight.ref) : flight.seat ? zoneSelector(flight.seat, flight.zone) : null;
        // Without motion the arrival is a blink in place.
        if (still) { if (target) later(() => rule(`blink:${flight.ref}`, `${target}{animation:fx-arrive-blink 480ms steps(2,jump-none) 2}`, 960), time.flyAt); continue; }
        flying.add(flight.ref);
        later(() => fly(flight, time.flyFor), time.flyAt);
      }
      // A card with nowhere to fly from simply appears.
      for (const event of arriving) if (!flying.has(event.target.cardRef)) rules.delete(`hide:${event.target.cardRef}`);
      syncRules();
      later(() => {
        for (const ref of flying) rules.delete(`hide:${ref}`);
        syncRules(); landed();
        for (const [seat, symbols] of installs) flashLamps(seat, symbols);
      }, time.end);
      endsAt = now() + time.end;
    };
    frame = win.requestAnimationFrame ? win.requestAnimationFrame(start) : (start(), null);
    return guess.end;
  };
  const remaining = () => Math.max(0, endsAt - (win.performance?.now() ?? Date.now()));
  return { play, flush, remaining, dispose() { disposed = true; flush(); } };
}
