// Effect speed (文豪, 2026-11-04, debug window): one factor through the effects' times. ×1 is the default and leaves
// every time as written (the e2e waits stay right); ×2 halves them, ×0.5 doubles them.
// CSS animations and transitions and element.animate() run at the factor (their playbackRate, set as they appear);
// the JS waits that pair with them go through fxMs.
export const FX_SPEED_STORAGE_KEY = 'sz-ui-fx-speed';
export const FX_SPEEDS = Object.freeze([0.5, 1, 2]);
export const readFxSpeed = value => FX_SPEEDS.includes(Number(value)) && value !== null && value !== '' ? Number(value) : 1;

let speed = 1;
export const fxSpeed = () => speed;
// A wait of `ms` at the current speed.
export const fxMs = ms => ms / speed;

let watching = null;
// Sets the factor for the page. While it is not 1 every animation of the document is brought to it once per frame
// (an animation is new, or was made at another factor); at 1 nothing runs and every animation is set back.
export function setFxSpeed(value, doc = globalThis.document) {
  speed = readFxSpeed(value);
  const win = doc?.defaultView;
  if (!win?.requestAnimationFrame || !doc.getAnimations) return speed;
  const sync = () => { for (const animation of doc.getAnimations()) if (animation.playbackRate !== speed) animation.playbackRate = speed; };
  if (watching) { win.cancelAnimationFrame(watching); watching = null; }
  sync();
  if (speed !== 1) {
    const tick = () => { sync(); watching = win.requestAnimationFrame(tick); };
    watching = win.requestAnimationFrame(tick);
  }
  return speed;
}

const choice = (value, current) => `<button data-fx-speed="${value}" role="radio" aria-checked="${current === value}">×${value}</button>`;
export function fxSpeedHtml(current = speed) {
  return `<section class="r2-debug-part" data-debug-fx-speed aria-label="演出のスピード"><h3>演出のスピード</h3><div class="r2-debug-row" role="radiogroup" aria-label="演出のスピード">${FX_SPEEDS.map(value => choice(value, current)).join('')}</div><p>演出の時間に1つの倍率を通す（×2 で半分の時間）。CSS のアニメーションとトランジションは画面全体に効く。選んだ値はこのブラウザに保存する。既定は ×1。</p></section>`;
}
