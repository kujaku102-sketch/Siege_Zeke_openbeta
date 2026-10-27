// Tutorial guide pages (文豪, 2026-10-28): one 「」 of the author's script is one page. A line splits into pages at
// the mark ▽ (never shown) and nowhere else; a page too long for the frame grows the frame instead (guide.js).
export const GUIDE_PAGE_MARK = '▽';

// [{ text, reason }]: reason 'mark' for a page ending at ▽, 'end' for the last page.
export function splitGuidePages(text) {
  const pieces = String(text ?? '').split(GUIDE_PAGE_MARK).map(piece => piece.trim()).filter(Boolean);
  const pages = pieces.map((piece, index) => ({ text: piece, reason: index < pieces.length - 1 ? 'mark' : 'end' }));
  return pages.length ? pages : [{ text: '', reason: 'end' }];
}
