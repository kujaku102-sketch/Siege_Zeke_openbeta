// The debug window's memory estimate (文豪, 2026-11-04): counted from what the page holds, the way the iOS compat
// review counted it, against a 1.4GB budget. It is not the browser's own number. main.js counts only while the window
// is open: when it opens and on its 更新 button.
// memoryEstimate is DOM-free (the rows from counted facts); sampleMemory reads the page; memoryHtml draws the block.

const MB = 1024 * 1024;
export const MEMORY_LIMIT_MB = 1.4 * 1024;
const BOARD_LINE_FILTER = 'wf-pixel-line';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const bytes = ({ w = 0, h = 0 }) => Math.max(0, w) * Math.max(0, h) * 4;
const sum = list => list.reduce((total, item) => total + bytes(item), 0);

// images: one {w,h} per image address (natural size); canvases: {w,h} drawing buffers; filters: {id,w,h} per filtered
// element (its filter region in device pixels); layers: {w,h} in device pixels; jsHeap: bytes, or null when unreadable.
export function memoryEstimate({ images = [], canvases = [], filters = [], layers = [], jsHeap = null } = {}) {
  const lines = filters.filter(item => item.id === BOARD_LINE_FILTER);
  const rows = [
    { key: 'images', label: '画像（展開後）', mb: sum(images) / MB, note: `${images.length}枚。同じ画像は1枚として数える` },
    { key: 'canvas', label: 'canvas', mb: sum(canvases) / MB, note: `${canvases.length}枚` },
    { key: 'filters', label: 'SVG のフィルター', mb: sum(filters) / MB, note: `${filters.length}要素。うち盤面の線 ${lines.length}要素（${(sum(lines) / MB).toFixed(1)}MB）` },
    { key: 'layers', label: '層', mb: sum(layers) / MB, note: `画面1枚と、層になりやすい要素 ${Math.max(0, layers.length - 1)}個` },
    { key: 'js', label: 'JS', mb: jsHeap === null ? null : jsHeap / MB, note: jsHeap === null ? 'このブラウザでは読めない' : 'performance.memory の使用中のヒープ' }
  ].map(row => ({ ...row, percent: row.mb === null ? null : row.mb / MEMORY_LIMIT_MB * 100 }));
  const totalMB = rows.reduce((total, row) => total + (row.mb ?? 0), 0);
  return { rows, totalMB, percent: totalMB / MEMORY_LIMIT_MB * 100, jsReadable: jsHeap !== null };
}

export const mb = value => `${value.toFixed(1)}MB`;
export const pct = value => `${value.toFixed(1)}%`;
// The block's words, shared with the CRT menu's drawing of it.
export const MEMORY_TEXT = Object.freeze({ title: 'メモリの見積もり', refresh: '更新', pending: '数えています…', total: '合計', noJs: 'JS を除く',
  lead: 'ページが持っている画像・canvas・SVG のフィルター・層の大きさ（縦×横×4バイト）から計算した見積もり。ブラウザが実際に使っているメモリの値ではない。上限は 1.4GB として計算。' });
// null: not counted yet (the window just opened or 更新 was pressed).
export function memoryHtml(estimate) {
  const head = `<header><h3>${MEMORY_TEXT.title}</h3><button data-memory-refresh>${MEMORY_TEXT.refresh}</button></header>`;
  const lead = `<p>${MEMORY_TEXT.lead}</p>`;
  if (!estimate) return `<section class="r2-memory" data-memory-estimate aria-label="メモリの見積もり" aria-busy="true">${head}${lead}<p data-memory-pending>${MEMORY_TEXT.pending}</p></section>`;
  const row = item => `<tr data-memory-row="${item.key}"><th scope="row">${esc(item.label)}<small>${esc(item.note)}</small></th><td>${item.mb === null ? '—' : mb(item.mb)}</td><td>${item.percent === null ? '—' : pct(item.percent)}</td></tr>`;
  return `<section class="r2-memory" data-memory-estimate aria-label="メモリの見積もり">${head}${lead}<table><thead><tr><th scope="col">内訳</th><th scope="col">見積もり</th><th scope="col">上限比</th></tr></thead><tbody>${estimate.rows.map(row).join('')}</tbody><tfoot><tr data-memory-row="total"><th scope="row">${MEMORY_TEXT.total}${estimate.jsReadable ? '' : `<small>${MEMORY_TEXT.noJs}</small>`}</th><td>${mb(estimate.totalMB)}</td><td>${pct(estimate.percent)}</td></tr></tfoot></table></section>`;
}

// The natural size of an image address, read once per page; an address that fails counts as 0x0.
const naturalSizes = new Map();
function naturalSize(url, view) {
  if (!naturalSizes.has(url)) naturalSizes.set(url, new Promise(resolve => {
    const image = new view.Image();
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight });
    image.onerror = () => resolve({ w: 0, h: 0 });
    image.src = url;
  }));
  return naturalSizes.get(url);
}

const urlsIn = value => [...String(value ?? '').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(match => match[1]);
// A filter attribute: a number in user units, or a share ("-25%", ".5") of `whole`.
const amount = (value, fallback, whole, fraction) => {
  if (value === null || value === '') return fallback * whole;
  return value.trim().endsWith('%') ? parseFloat(value) / 100 * whole : fraction ? parseFloat(value) * whole : parseFloat(value);
};
// The region of an SVG filter on one element, in device pixels.
function filterRegion(element, filter, dpr) {
  const m = element.getScreenCTM?.();
  if (!m) return null;
  const sx = Math.hypot(m.a, m.b) * dpr, sy = Math.hypot(m.c, m.d) * dpr;
  const user = filter.getAttribute('filterUnits') === 'userSpaceOnUse';
  const viewBox = element.ownerSVGElement?.viewBox?.baseVal, box = user ? null : element.getBBox?.();
  const width = user ? (viewBox?.width || 0) : (box?.width ?? 0), height = user ? (viewBox?.height || 0) : (box?.height ?? 0);
  // The SVG defaults: -10% / 120% of the box (or of the viewport in user units).
  const w = amount(filter.getAttribute('width'), 1.2, width, !user), h = amount(filter.getAttribute('height'), 1.2, height, !user);
  return { id: filter.id, w: Math.round(w * sx), h: Math.round(h * sy) };
}

// What the page holds now. `view` is the window.
export async function sampleMemory(doc, view) {
  const dpr = view.devicePixelRatio || 1, vw = view.innerWidth, vh = view.innerHeight;
  const absolute = href => { try { return new URL(href, doc.baseURI).href; } catch { return null; } };
  const sizes = new Map(), pending = new Map();
  for (const image of doc.querySelectorAll('img')) {
    const url = image.currentSrc || image.src;
    if (url && image.complete && image.naturalWidth) sizes.set(url, { w: image.naturalWidth, h: image.naturalHeight });
  }
  const want = url => { if (url && !sizes.has(url) && !pending.has(url)) pending.set(url, naturalSize(url, view)); };
  for (const image of doc.querySelectorAll('image')) want(absolute(image.href?.baseVal ?? image.getAttribute('href')));
  const filters = [], layers = [{ w: Math.round(vw * dpr), h: Math.round(vh * dpr) }];
  const shown = element => {
    const r = element.getBoundingClientRect(), w = Math.min(vw, r.right) - Math.max(0, r.left), h = Math.min(vh, r.bottom) - Math.max(0, r.top);
    return w > 0 && h > 0 ? { w: Math.round(w * dpr), h: Math.round(h * dpr) } : null;
  };
  for (const element of doc.querySelectorAll('*')) {
    const style = view.getComputedStyle(element);
    for (const pseudo of [style, view.getComputedStyle(element, '::before'), view.getComputedStyle(element, '::after')])
      if (pseudo.backgroundImage !== 'none') for (const url of urlsIn(pseudo.backgroundImage)) want(absolute(url));
    if (element instanceof view.SVGElement && style.filter !== 'none') {
      const id = urlsIn(style.filter)[0]?.split('#').pop(), filter = id ? doc.getElementById(id) : null;
      const region = filter && filterRegion(element, filter, dpr);
      if (region) filters.push(region);
    }
    // Boxes a browser tends to draw on their own layer: fixed, 3D, will-change, backdrop blur, a scroller.
    const scroller = /(auto|scroll)/.test(style.overflowX + style.overflowY) && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
    if (style.position === 'fixed' || /matrix3d/.test(style.transform) || style.willChange !== 'auto' || (style.backdropFilter ?? 'none') !== 'none' || scroller) {
      const box = shown(element);
      if (box) layers.push(box);
    }
  }
  for (const [url, size] of pending) sizes.set(url, await size);
  const canvases = [...doc.querySelectorAll('canvas')].map(canvas => ({ w: canvas.width, h: canvas.height }));
  const heap = view.performance?.memory?.usedJSHeapSize;
  return { images: [...sizes.values()].filter(size => size.w && size.h), canvases, filters, layers, jsHeap: Number.isFinite(heap) ? heap : null };
}
