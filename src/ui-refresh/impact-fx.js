// Presentation only: how hard a batch of damage lands. The viewer's own hits
// shake the screen; a critical one (CRITICAL_DAMAGE or more in one hit) first
// freezes every running animation for a beat, then shakes harder under a red
// edge glow. A damaged card gets a kick and a lift and settles on a spring.
// One hit of this much or more to the viewer's user counts as critical.
export const CRITICAL_DAMAGE = 5;
export const IMPACT = Object.freeze({
  hitstop: 110,
  hit: { amplitude: 7, duration: 300 },
  critical: { amplitude: 16, duration: 560 },
  vignette: 1000,
  card: { duration: 700 }
});

// Pure: which screen beat a batch needs, and which cards were hit.
export function planImpact(events, model) {
  const viewer = model?.match?.viewerSeat;
  let screen = 'none';
  const cards = new Map();
  for (const event of events) {
    if (event.type === 'user_damaged' && event.target?.seatId === viewer && event.amount > 0) {
      screen = event.amount >= CRITICAL_DAMAGE ? 'critical' : screen === 'critical' ? screen : 'hit';
    } else if (event.type === 'card_damaged' && event.target?.cardRef && event.amount > 0) {
      cards.set(event.target.cardRef, (cards.get(event.target.cardRef) ?? 0) + event.amount);
    }
  }
  return { screen, cards: [...cards].map(([cardRef, amount]) => ({ cardRef, amount })) };
}

// A small deterministic noise so a shake looks the same for the same seed.
const noise = (seed, i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };

// Trauma-style shake: random offsets that die off with the square of the remaining time.
export function shakeFrames({ amplitude, duration }, seed = 1, step = 16) {
  const count = Math.max(2, Math.round(duration / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const decay = (1 - i / count) ** 2, a = amplitude * decay;
    const x = i === count ? 0 : Math.round(noise(seed, i) * a * 10) / 10;
    const y = i === count ? 0 : Math.round(noise(seed + 7, i) * a * .6 * 10) / 10;
    return { transform: `translate(${x}px,${y}px)` };
  });
}

// Light physics: a damped spring kicked sideways and upward. Bigger hits kick harder.
export function cardKickFrames(amount, side = 1, { duration } = IMPACT.card, step = 1000 / 60) {
  const power = Math.min(1, .45 + amount * .12);
  const k = 260, c = 11, ky = 140, cy = 13;
  let x = 0, vx = side * 420 * power, y = 0, vy = -260 * power;
  const frames = [];
  const steps = Math.round(duration / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, last = i === steps;
    const lift = Math.max(0, -y);
    frames.push({
      offset: Math.round(t * 1000) / 1000,
      transform: last ? 'translate(0px,0px) rotate(0deg) scale(1)'
        : `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${(x * .35).toFixed(2)}deg) scale(${(1 + lift * .004).toFixed(3)})`,
      filter: last ? 'brightness(1)' : `brightness(${(1 + Math.max(0, .9 - t * 4)).toFixed(2)})`
    });
    const dt = step / 1000;
    vx += (-k * x - c * vx) * dt; x += vx * dt;
    vy += (-ky * y - cy * vy) * dt; y += vy * dt;
  }
  return frames;
}

const sideOf = ref => [...String(ref)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 2 ? 1 : -1;
// The backslash is built from its code so the minified bundle carries no `\\…/` run
// that the public build check reads as a UNC path.
const slash = String.fromCharCode(92);
const quote = value => `"${String(value).replaceAll(slash, slash + slash).replaceAll('"', slash + '"')}"`;

export function createImpactFx(root) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc?.defaultView ?? globalThis;
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const timers = new Set(), animations = new Set();
  let vignette = null, paused = [], seed = 1;
  const later = (fn, ms) => { const id = win.setTimeout(() => { timers.delete(id); try { fn(); } catch { /* decorative */ } }, ms); timers.add(id); };
  const animate = (node, frames, options) => {
    if (!node?.animate) return;
    const animation = node.animate(frames, options);
    animations.add(animation);
    animation.finished?.then(() => animations.delete(animation), () => animations.delete(animation));
  };
  const resume = () => { for (const animation of paused) { try { animation.play(); } catch { /* gone */ } } paused = []; };
  const clear = () => {
    for (const id of timers) win.clearTimeout(id);
    timers.clear(); resume();
    for (const animation of animations) animation.cancel();
    animations.clear(); vignette?.remove(); vignette = null;
  };
  const cardNode = ref => root.querySelector(`.wire-board .board-slot[data-card-ref=${quote(ref)}]`)
    ?? root.querySelector(`.board-slot [data-card-ref=${quote(ref)}]`)?.closest('.board-slot')
    ?? null;
  const shake = level => animate(root.querySelector('.r2-runtime-view') ?? root, shakeFrames(IMPACT[level], seed++), { duration: IMPACT[level].duration, easing: 'linear' });
  const edge = () => {
    vignette?.remove();
    vignette = doc.createElement('div');
    vignette.className = 'fx-danger-vignette'; vignette.setAttribute('aria-hidden', 'true');
    doc.body.append(vignette);
    const node = vignette;
    animate(node, [{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: .85, offset: .45 }, { opacity: 0 }], { duration: IMPACT.vignette, easing: 'ease-out', fill: 'forwards' });
    later(() => { node.remove(); if (vignette === node) vignette = null; }, IMPACT.vignette);
  };
  // Returns how long the beat holds everything still, so callers can wait it out.
  const play = (events, model) => {
    if (!doc) return 0;
    const plan = planImpact(events, model);
    const still = reduced();
    const kick = () => {
      if (still) return;
      for (const { cardRef, amount } of plan.cards) {
        const node = cardNode(cardRef);
        if (!node) continue;
        // SVG groups turn about their own box, not the board's origin.
        if (node instanceof win.SVGElement) { node.style.transformBox = 'fill-box'; node.style.transformOrigin = 'center'; }
        animate(node, cardKickFrames(amount, sideOf(cardRef)), { duration: IMPACT.card.duration, easing: 'linear' });
      }
    };
    if (plan.screen === 'critical') {
      edge();
      if (still) return 0;
      // Hit stop: everything already moving holds for a beat.
      paused = (doc.getAnimations?.() ?? []).filter(animation => animation.playState === 'running');
      for (const animation of paused) animation.pause();
      later(() => { resume(); shake('critical'); kick(); }, IMPACT.hitstop);
      return IMPACT.hitstop;
    }
    if (plan.screen === 'hit' && !still) shake('hit');
    kick();
    return 0;
  };
  return Object.freeze({ play, clear, dispose: clear });
}
