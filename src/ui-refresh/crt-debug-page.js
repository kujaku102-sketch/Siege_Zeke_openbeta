// The debug page drawn on the CRT menu (文豪, 2026-11-04): the HTML page's content (debug-view.js) in the options'
// look, green on the dark panel. It draws a list that scrolls under the page's header and returns where its controls
// are, each as the selector of the HTML control it presses (the CRT keeps those for the keyboard too).
import { BUILD_TEXT } from './debug-tools.js';
import { ERROR_LOG_TEXT, errorLogHeading } from './error-log.js';
import { MEMORY_TEXT, mb, pct } from './memory-estimate.js';
import { RENDER_SCALE_CHOICES } from './render-mode.js';
import { RENDER_SCALE_NOTE, renderScaleNotes } from './debug-settings-view.js';
import { FX_SPEEDS, FX_SPEED_NOTE } from './fx-speed.js';

const INK = "#e8ffe8", GREEN = "#00ff00", DIM = "#8fc79a", OFF = "#2f6b46";

// Lines of `text` that fit `width` in the context's current font, cut between characters (Japanese has no spaces);
// closing punctuation never starts a line.
const wrapped = new Map();
const CLOSING = new Set([..."。、，．）」』】"]);
function wrap(ctx, text, width) {
  const key = `${ctx.font}|${Math.round(width)}|${text}`;
  if (wrapped.has(key)) return wrapped.get(key);
  const lines = [];
  let line = "";
  for (const ch of String(text)) {
    if (line && !CLOSING.has(ch) && ctx.measureText(line + ch).width > width) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  if (wrapped.size > 400) wrapped.clear();
  wrapped.set(key, lines);
  return lines;
}

// debug: { build, errors:{entries,total,copied}, memory, renderScale, renderScaleUrl, compat, fxSpeed }.
// area: { left, width, top, bottom, unit, font } (the list's view; unit = the frame's height). scroll: the list's
// offset. focused: the selector of the focused HTML control, or null. Draws when `paint`; returns the content's height,
// the visible targets, and every control's place in the list (`all`, from the list's top) for keeping the focus in view.
export function drawCrtDebugPage(ctx, debug, area, { scroll = 0, focused = null, paint = true } = {}) {
  const { left, width, top, bottom, unit, font } = area;
  const size = { head: Math.max(13, unit * .038), body: Math.max(11, unit * .029), small: Math.max(10, unit * .025) };
  const gap = unit * .012;
  const targets = [];
  const all = [];
  let cursor = 0;
  const y = () => top + cursor - scroll;
  const setFont = px => { ctx.font = `400 ${px}px ${font}`; };
  const visible = box => box.y >= top - 1 && box.y + box.height <= bottom + 1;
  const target = (box, selector) => {
    all.push({ selector, y: box.y + scroll - top, height: box.height });
    if (visible(box)) targets.push({ box, selector });
  };
  const text = (value, px, color, align = "left", x = left, maxWidth) => {
    if (!paint) return;
    setFont(px); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.fillText(value, x, y() + px * .65, maxWidth);
  };
  const lines = (value, px, color) => {
    setFont(px);
    for (const line of wrap(ctx, value, width)) { text(line, px, color); cursor += px * 1.35; }
  };
  const heading = value => { cursor += gap; text(value, size.head, GREEN, "left", left, width * .7); cursor += size.head * 1.45; };
  const rule = () => {
    cursor += gap;
    if (paint) { ctx.strokeStyle = "rgba(0,255,0,.35)"; ctx.lineWidth = Math.max(1, unit * .0015); ctx.beginPath(); ctx.moveTo(left, y()); ctx.lineTo(left + width, y()); ctx.stroke(); }
  };
  const box = (label, selector, x, w, h, { enabled = true, checked = false, px = size.body } = {}) => {
    const at = { x, y: y(), width: w, height: h };
    if (paint) {
      if (checked) { ctx.fillStyle = "rgba(0,255,0,.22)"; ctx.fillRect(at.x, at.y, at.width, at.height); }
      if (selector === focused) { ctx.fillStyle = "rgba(0,255,0,.14)"; ctx.fillRect(at.x, at.y, at.width, at.height); }
      ctx.strokeStyle = enabled ? GREEN : OFF; ctx.lineWidth = Math.max(1, unit * (checked ? .003 : .002));
      ctx.strokeRect(at.x, at.y, at.width, at.height);
      setFont(px); ctx.fillStyle = enabled ? INK : "#5d7f68"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, at.x + at.width / 2, at.y + at.height / 2, at.width - 4);
    }
    if (enabled) target(at, selector);
    return at;
  };
  const buttonHeight = size.body * 2;

  // 版
  heading("版");
  const revision = debug.build === undefined ? BUILD_TEXT.loading : debug.build?.revision ?? BUILD_TEXT.none;
  lines(`buildRevision：${revision}`, size.body, debug.build?.revision ? GREEN : INK);
  lines(BUILD_TEXT.note, size.small, DIM);
  cursor += gap * .5;
  setFont(size.body);
  box(BUILD_TEXT.clear, "[data-debug-clear-reload]", left, Math.min(width, ctx.measureText(BUILD_TEXT.clear).width + size.body * 2), buttonHeight);
  cursor += buttonHeight + gap * .5;
  lines(BUILD_TEXT.clearNote, size.small, DIM);

  // エラーの記録
  const errors = debug.errors ?? { entries: [], total: 0, copied: null };
  rule(); heading(errorLogHeading(errors.entries.length, errors.total));
  lines(ERROR_LOG_TEXT.note, size.small, DIM);
  cursor += gap * .5;
  setFont(size.body);
  const copy = box(ERROR_LOG_TEXT.copy, "[data-error-copy]", left, ctx.measureText(ERROR_LOG_TEXT.copy).width + size.body * 2, buttonHeight, { enabled: errors.entries.length > 0 });
  if (errors.copied !== null && errors.copied !== undefined) text(errors.copied ? ERROR_LOG_TEXT.copied : ERROR_LOG_TEXT.failed, size.small, GREEN, "left", copy.x + copy.width + size.body);
  cursor += buttonHeight + gap * .5;
  if (!errors.entries.length) lines(ERROR_LOG_TEXT.empty, size.small, INK);
  for (const entry of errors.entries) lines(`${entry.kind} ${entry.at.slice(11, 19)} ${entry.message}`, size.small, INK);

  // メモリの見積もり
  rule(); heading(MEMORY_TEXT.title);
  setFont(size.body);
  const refreshWidth = ctx.measureText(MEMORY_TEXT.refresh).width + size.body * 2;
  cursor -= size.head * 1.45;
  box(MEMORY_TEXT.refresh, "[data-memory-refresh]", left + width - refreshWidth, refreshWidth, buttonHeight);
  cursor += Math.max(size.head * 1.45, buttonHeight + gap * .5);
  lines(MEMORY_TEXT.lead, size.small, DIM);
  if (!debug.memory) lines(MEMORY_TEXT.pending, size.body, INK);
  else {
    // Label on the left, the size and its share of 1.4GB in two right-aligned columns.
    const valueRight = left + width * .8, shareRight = left + width;
    for (const row of [...debug.memory.rows, { label: debug.memory.jsReadable ? MEMORY_TEXT.total : `${MEMORY_TEXT.total}（${MEMORY_TEXT.noJs}）`, mb: debug.memory.totalMB, percent: debug.memory.percent, total: true }]) {
      cursor += gap * .4;
      const color = row.total ? GREEN : INK;
      text(row.label, size.body, color, "left", left, width * .55);
      text(row.mb === null ? "—" : mb(row.mb), size.body, color, "right", valueRight);
      text(row.percent === null ? "—" : pct(row.percent), size.body, color, "right", shareRight);
      cursor += size.body * 1.35;
      if (row.note) lines(row.note, size.small, DIM);
    }
  }

  // 描画の倍率 / 演出のスピード
  const choices = (values, attr, current) => {
    const each = Math.min(width / values.length, size.body * 4.2), boxGap = unit * .006;
    values.forEach((value, index) => box(`×${value}`, `[${attr}="${value}"]`, left + index * each, each - boxGap, buttonHeight, { checked: current === value }));
    cursor += buttonHeight + gap * .5;
  };
  rule(); heading("描画の倍率");
  choices(RENDER_SCALE_CHOICES, "data-render-scale", debug.renderScale ?? 1);
  lines(RENDER_SCALE_NOTE, size.small, DIM);
  for (const note of renderScaleNotes({ render: { mode: debug.compat ? "compat" : "full" }, renderScaleUrl: debug.renderScaleUrl })) lines(note, size.small, GREEN);
  rule(); heading("演出のスピード");
  choices(FX_SPEEDS, "data-fx-speed", debug.fxSpeed ?? 1);
  lines(FX_SPEED_NOTE, size.small, DIM);
  cursor += gap * 2;
  return { height: cursor, targets, all };
}
