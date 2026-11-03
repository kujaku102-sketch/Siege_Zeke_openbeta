// The debug page (文豪, 2026-11-04): a second page of the options window, on the title (HTML and CRT menus) and on the
// board. デバッグ ▶ slides the window's content to it (the options leave to the left, the debug page comes from the
// right) and ◀ 戻る slides back; the CRT menu draws the same page on its canvas (entry-crt-viewport.js).
import { memoryHtml } from './memory-estimate.js';
import { buildHtml } from './debug-tools.js';
import { errorLogHtml } from './error-log.js';
import { renderScaleHtml } from './debug-settings-view.js';
import { fxSpeedHtml } from './fx-speed.js';

export const debugEntryHtml = () => '<button class="r2-debug-open" data-debug-open>デバッグ<span aria-hidden="true">▶</span></button>';

const page = (active, attrs, html) => `<div class="r2-page" ${attrs}${active ? '' : ' inert aria-hidden="true"'}>${html}</div>`;
// The options window's content as two pages; `options` is the options page's own HTML.
export function pagedOptionsHtml(host, options) {
  const debug = Boolean(host.debug);
  return `<div class="r2-pager" data-page="${debug ? 'debug' : 'options'}">${page(!debug, 'data-options-page', options)}${page(debug, 'data-debug-page', debugPageHtml(host))}</div>`;
}

export function debugPageHtml(host) {
  const sections = [buildHtml(host.build), errorLogHtml(host.errors ?? {}), memoryHtml(host.memory), renderScaleHtml(host), fxSpeedHtml(host.fxSpeed)];
  return `<section class="r2-debug" aria-label="デバッグ"><header><button data-debug-close><span aria-hidden="true">◀</span> 戻る</button><h2>デバッグ</h2></header>${sections.join('')}</section>`;
}
