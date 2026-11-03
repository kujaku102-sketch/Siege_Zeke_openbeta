// The debug window (文豪, 2026-11-04): every debug tool opens from one デバッグ entry of the options, on the title
// (HTML and CRT menus) and on the board. It is HTML over everything, never drawn on the CRT canvas.
import { memoryHtml } from './memory-estimate.js';
import { buildHtml } from './debug-tools.js';
import { errorLogHtml } from './error-log.js';
import { renderScaleHtml } from './debug-settings-view.js';
import { fxSpeedHtml } from './fx-speed.js';

export const debugEntryHtml = () => '<button class="r2-debug-open" data-debug-open>デバッグ</button>';

export function debugHtml(host) {
  const sections = [buildHtml(host.build), errorLogHtml(host.errors ?? {}), memoryHtml(host.memory), renderScaleHtml(host), fxSpeedHtml(host.fxSpeed)];
  return `<div class="r2-modal r2-debug" role="dialog" aria-modal="true" aria-label="デバッグ"><section><header><h2>デバッグ</h2><button data-debug-close>閉じる</button></header>${sections.join('')}</section></div>`;
}
