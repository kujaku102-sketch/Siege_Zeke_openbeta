// Tutorial guide pages (文豪's choice: manual break marks first, automatic splitting only as a fallback).
// DOM-free: the caller says how many lines a text takes on this screen (`lineCount`).
//
// A line splits into pages at the mark ▽ (never shown). A page still longer than GUIDE_MAX_LINES is cut
// at the last sentence end that fits (after 。！？… and any closing brackets right after them), else at the
// last 、, else after as many characters as fit; a page never starts with a character that may not start a
// line (。、」 and the like), the same rule the browser keeps when it wraps.
export const GUIDE_MAX_LINES = 3;
export const GUIDE_PAGE_MARK = '▽';

const SENTENCE_END = new Set([...'。！？!?…']);
const COMMA = new Set([...'、，,']);
const CLOSING = new Set([...'」』）)】〕〉》"\'']);
// Characters a page (like a line) may not start with.
const NO_START = new Set([...'。、，．,.・：:；;？?！!）)」』】〕〉》…ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ〜']);

// Where a cut may fall: between chars[i - 1] and chars[i].
const startsCleanly = (chars, i) => i >= chars.length || !NO_START.has(chars[i]);
function sentenceEnd(chars, i) {
  let j = i - 1;
  while (j >= 0 && CLOSING.has(chars[j])) j -= 1;
  return j >= 0 && SENTENCE_END.has(chars[j]) && startsCleanly(chars, i);
}
const afterComma = (chars, i) => COMMA.has(chars[i - 1]) && startsCleanly(chars, i);

// The longest prefix (in characters) that keeps within maxLines; at least one character.
function fittingLength(chars, maxLines, lineCount) {
  let low = 1, high = chars.length;
  if (lineCount(chars.join('')) <= maxLines) return chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineCount(chars.slice(0, middle).join('')) <= maxLines) low = middle; else high = middle - 1;
  }
  return low;
}

function cutPoint(chars, limit) {
  for (let i = limit; i > 0; i -= 1) if (sentenceEnd(chars, i)) return { at: i, reason: 'sentence' };
  for (let i = limit; i > 0; i -= 1) if (afterComma(chars, i)) return { at: i, reason: 'comma' };
  let i = limit;
  while (i > 1 && !startsCleanly(chars, i)) i -= 1;
  return { at: i, reason: i === limit ? 'length' : 'kinsoku' };
}

// [{ text, reason }]: reason says why the page ends where it does ('mark' for ▽, 'sentence', 'comma',
// 'length', 'kinsoku', or 'end' for the last page).
export function splitGuidePages(text, { maxLines = GUIDE_MAX_LINES, lineCount } = {}) {
  const pieces = String(text ?? '').split(GUIDE_PAGE_MARK).map(piece => piece.trim()).filter(Boolean);
  const pages = [];
  for (const [index, piece] of pieces.entries()) {
    let chars = [...piece];
    while (chars.length) {
      const fits = typeof lineCount === 'function' ? fittingLength(chars, maxLines, lineCount) : chars.length;
      if (fits >= chars.length) { pages.push({ text: chars.join(''), reason: index < pieces.length - 1 ? 'mark' : 'end' }); break; }
      const { at, reason } = cutPoint(chars, fits);
      pages.push({ text: chars.slice(0, at).join('').trim(), reason });
      chars = [...chars.slice(at).join('').trimStart()];
    }
  }
  return pages.length ? pages : [{ text: '', reason: 'end' }];
}
