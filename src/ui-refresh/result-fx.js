import { fxSpeed } from "./fx-speed.js";
// Decorative only: the end screen's outcome and buttons stay HTML. A win gets dot confetti; a defeat the same confetti
// with noise running through it once it is up, and on (文豪, 2026-11-01); a draw nothing for now.
let active = null;

export function syncResultFx(root, enabled) {
  const canvas = enabled && !matchMedia("(prefers-reduced-motion: reduce)").matches
    ? root.querySelector(".r2-result-fx") : null;
  // A patch keeps the canvas when only the outcome changes (the other seat's view): the effect restarts for it.
  const outcome = canvas?.closest("[data-outcome]")?.dataset.outcome;
  if (active?.canvas === canvas && active?.outcome === outcome) return;
  active?.dispose();
  active = null;
  if (!canvas) return;
  const dispose = outcome === "win" ? confetti(canvas) : outcome === "defeat" ? confetti(canvas, { noise: true }) : null;
  if (dispose) active = { canvas, outcome, dispose };
}

// The defeat's noise: it starts once the burst is up and grows to full over a second, then keeps running. Bands of the
// screen torn sideways under a red or cyan cast, static, and scan lines, so it reads as a broken signal, not more dots.
export const NOISE = Object.freeze({ after: 0.9, rise: 1, tears: 5, shift: 9, static: .03, lines: 3,
  colors: ["#ff3d5a","#29dbff","#9aa3b5","#f6f8fc"], casts: ["#ff3d5a38","#29dbff30"] });

// Pure: one frame of noise on a width x height dot grid at strength 0..1.
export function noiseFrame(random, width, height, strength) {
  if (strength <= 0) return { tears: [], dots: [], lines: [] };
  const tears = Array.from({ length: Math.max(1, Math.round(NOISE.tears * strength * (.5 + random()))) }, () => {
    const y = Math.floor(random() * height), h = 1 + Math.floor(random() * 4);
    return { y, h: Math.min(h, height - y), dx: Math.round((random() * 2 - 1) * NOISE.shift * strength) || 1,
      cast: NOISE.casts[Math.floor(random() * NOISE.casts.length)] };
  });
  const dots = Array.from({ length: Math.round(width * height * NOISE.static * strength) }, () => ({
    x: Math.floor(random() * width), y: Math.floor(random() * height), color: NOISE.colors[Math.floor(random() * NOISE.colors.length)] }));
  const lines = Array.from({ length: Math.max(1, Math.round(NOISE.lines * strength)) }, () => Math.floor(random() * height));
  return { tears, dots, lines };
}

// PS1 style confetti: square dots on a coarse grid, stepped at a low frame rate.
export const CONFETTI = Object.freeze({
  dot: 6, fps: 20, count: 160, burst: 100, gravity: 34, drag: .985,
  colors: ["#29dbff","#ff3d8b","#ffd23f","#3dff6e","#f6f8fc","#a77bff"]
});

// Pure: one piece of confetti. A burst piece shoots up from a lower corner, a rain piece drifts down from the top.
export function confettiPiece(random, width, height, burst) {
  const color = CONFETTI.colors[Math.floor(random() * CONFETTI.colors.length)];
  const phase = random() * Math.PI * 2, spin = 4 + random() * 6, size = random() < .3 ? 2 : 1;
  if (burst) {
    const left = random() < .5;
    return { x: left ? 0 : width, y: height, vx: (left ? 1 : -1) * width * (.15 + random() * .3), vy: -height * (.5 + random() * .35),
      color, phase, spin, size };
  }
  return { x: random() * width, y: -2 - random() * height * .5, vx: (random() - .5) * 6, vy: 6 + random() * 10, color, phase, spin, size };
}

// Pure: advances a piece by dt seconds. Sway and the flip both come from the phase.
export function stepPiece(piece, dt) {
  const drag = CONFETTI.drag ** (dt * 60);
  piece.vx *= drag; piece.vy = piece.vy * drag + CONFETTI.gravity * dt;
  piece.vy = Math.min(piece.vy, 14);
  piece.phase += piece.spin * dt;
  piece.x += (piece.vx + Math.sin(piece.phase) * 5) * dt;
  piece.y += piece.vy * dt;
  return piece;
}

function confetti(canvas, { noise = false } = {}) {
  const g = canvas.getContext("2d", noise ? { willReadFrequently: true } : undefined);
  if (!g) return null;
  canvas.classList.add("is-dots");
  const random = Math.random;
  let width = 0, height = 0, pieces = [], frame = 0, last = 0, started = 0, stopped = false;
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth / CONFETTI.dot)), h = Math.max(1, Math.round(canvas.clientHeight / CONFETTI.dot));
    if (w === width && h === height) return;
    width = w; height = h; canvas.width = w; canvas.height = h; g.imageSmoothingEnabled = false;
  };
  resize();
  pieces = Array.from({ length: CONFETTI.count }, (_, i) => confettiPiece(random, width, height, i < CONFETTI.burst));
  const draw = now => {
    if (stopped) return;
    frame = requestAnimationFrame(draw);
    if (last && now - last < 1000 / CONFETTI.fps) return;
    const dt = last ? Math.min(.1, (now - last) / 1000) * fxSpeed() : 0;
    last = now; started ||= now;
    resize();
    g.clearRect(0, 0, width, height);
    for (let i = 0; i < pieces.length; i++) {
      const piece = stepPiece(pieces[i], dt);
      if (piece.y > height + 2 || piece.x < -4 || piece.x > width + 4) { pieces[i] = confettiPiece(random, width, height, false); continue; }
      // The flip: a dot narrows to a sliver and back as it turns.
      const face = Math.abs(Math.cos(piece.phase));
      g.fillStyle = face < .35 ? "#0b1424" : piece.color;
      g.fillRect(Math.round(piece.x), Math.round(piece.y), face < .35 ? 1 : piece.size, piece.size);
    }
    if (noise) {
      const shown = noiseFrame(random, width, height, Math.min(1, Math.max(0, ((now - started) * fxSpeed() / 1000 - NOISE.after) / NOISE.rise)));
      for (const tear of shown.tears) {
        g.putImageData(g.getImageData(0, tear.y, width, tear.h), tear.dx, tear.y);
        g.fillStyle = tear.cast; g.fillRect(0, tear.y, width, tear.h);
      }
      for (const dot of shown.dots) { g.fillStyle = dot.color; g.fillRect(dot.x, dot.y, 1, 1); }
      g.fillStyle = "#ff3d5a55";
      for (const line of shown.lines) g.fillRect(0, line, width, 1);
    }
  };
  frame = requestAnimationFrame(draw);
  return () => { stopped = true; cancelAnimationFrame(frame); canvas.classList.remove("is-dots"); };
}
