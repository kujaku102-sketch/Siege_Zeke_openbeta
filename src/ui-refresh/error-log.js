// The debug window's error log (文豪, 2026-11-04): window `error` and `unhandledrejection` since the page opened, the
// newest ERROR_LOG_LIMIT kept in this page only. A reload, or the page dropped for memory, loses it.

export const ERROR_LOG_LIMIT = 50;
const STACK_LINES = 6;

const text = value => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};
const stackOf = value => typeof value?.stack === 'string' ? value.stack.split('\n').slice(0, STACK_LINES).join('\n') : '';

// One entry from an ErrorEvent or a PromiseRejectionEvent (or a plain object of the same shape in tests).
export function errorEntry(event, at = new Date()) {
  if (event.type === 'unhandledrejection') return { at: at.toISOString(), kind: 'unhandledrejection', message: text(event.reason), where: '', stack: stackOf(event.reason) };
  const where = event.filename ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}` : '';
  return { at: at.toISOString(), kind: 'error', message: event.error ? text(event.error) : String(event.message ?? ''), where, stack: stackOf(event.error) };
}

// Listens on `win`; `changed` runs after each new entry.
export function createErrorLog(win, { limit = ERROR_LOG_LIMIT, changed = () => {} } = {}) {
  const entries = [];
  let total = 0;
  const record = event => {
    entries.push(errorEntry(event)); total += 1;
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    try { changed(); } catch { /* the log never throws into the page */ }
  };
  win.addEventListener('error', record);
  win.addEventListener('unhandledrejection', record);
  return Object.freeze({
    entries: () => entries.slice().reverse(),
    total: () => total,
    dispose() { win.removeEventListener('error', record); win.removeEventListener('unhandledrejection', record); }
  });
}

// The whole log as plain text, newest first (what コピー puts on the clipboard).
export const errorLogText = entries => entries.map(entry => [`[${entry.at}] ${entry.kind}: ${entry.message}`, entry.where, entry.stack].filter(Boolean).join('\n')).join('\n\n');

// The page's words, shared with the CRT menu's drawing of it.
export const ERROR_LOG_TEXT = Object.freeze({ note: `window の error と unhandledrejection を、新しい順に最大${ERROR_LOG_LIMIT}件残す。残すのはこのページの中だけで、読み直したときや、メモリ不足でページが落とされたときは残らない。`,
  empty: '記録はない。', copy: 'まとめてコピー', copied: 'コピーした', failed: 'コピーできなかった' });
export const errorLogHeading = (shown, total) => `エラーの記録（${shown}件${total > shown ? `／このページを開いてから ${total}件` : ''}）`;

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// entries: newest first; total: every entry since the page opened; copied: the last コピー's outcome (null before one).
export function errorLogHtml({ entries = [], total = 0, copied = null } = {}) {
  const list = entries.length
    ? `<ol class="r2-error-list">${entries.map(entry => `<li data-error-entry><b>${esc(entry.kind)}</b> <time>${esc(entry.at)}</time><span>${esc(entry.message)}</span>${entry.where ? `<small>${esc(entry.where)}</small>` : ''}</li>`).join('')}</ol>`
    : `<p data-error-empty>${ERROR_LOG_TEXT.empty}</p>`;
  const status = copied === null ? '' : `<span data-error-copied role="status">${copied ? ERROR_LOG_TEXT.copied : ERROR_LOG_TEXT.failed}</span>`;
  return `<section class="r2-debug-part" data-debug-errors aria-label="エラーの記録"><h3>${errorLogHeading(entries.length, total)}</h3><p>${ERROR_LOG_TEXT.note}</p><div class="r2-debug-row"><button data-error-copy ${entries.length ? '' : 'disabled'}>${ERROR_LOG_TEXT.copy}</button>${status}</div>${list}</section>`;
}
