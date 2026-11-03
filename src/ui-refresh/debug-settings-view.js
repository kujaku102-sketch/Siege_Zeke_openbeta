// The debug window's choices (文豪, 2026-11-04): the full-mode drawing scale and the effect speed.
import { RENDER_SCALE_CHOICES } from './render-mode.js';

const choice = (attr, value, label, current) => `<button ${attr}="${value}" role="radio" aria-checked="${current === value}">${label}</button>`;

// host.renderScale: the saved choice (null = 1); host.renderScaleUrl: ?renderScale= (wins); host.render.mode: the mode in use.
export function renderScaleHtml(host) {
  const current = host.renderScale ?? 1;
  const notes = [];
  if (host.render?.mode === 'compat') notes.push('軽量表示では変わらない（軽量表示は常に 1）。');
  if (host.renderScaleUrl !== null && host.renderScaleUrl !== undefined) notes.push(`URL の指定（?renderScale=${host.renderScaleUrl}）が優先中。`);
  return `<section class="r2-debug-part" data-debug-render-scale aria-label="描画の倍率"><h3>描画の倍率</h3><div class="r2-debug-row" role="radiogroup" aria-label="描画の倍率">${RENDER_SCALE_CHOICES.map(value => choice('data-render-scale', value, `×${value}`, current)).join('')}</div><p>通常表示の WebGL の盤面・HUD と、命の数の canvas を描く倍率（CSS の 1px あたり）。選んだ値はこのブラウザに保存する。</p>${notes.map(note => `<p data-render-scale-note>${note}</p>`).join('')}</section>`;
}
