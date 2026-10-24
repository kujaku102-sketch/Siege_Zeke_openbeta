import { presentationLabel } from './choice-read-view.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// Cards whose picks walk through their text in several steps: the phrase each pick resolves.
// A rule matches on the request's presentation key, a piece of its title, or the staged group.
const FLOW_PHRASES = {
  'STD-086': [
    { key: 'execution-targets', phrase: '相手のOb1体に3ダメージ' },
    { title: '追加効果', phrase: '自分エリアのカード1枚を破壊して①を起動できる' }
  ],
  'STD-163': [
    { title: '破壊処理', phrase: '自分のObを好きな数破壊する' },
    { key: 'choice', phrase: 'こうして破壊したOb一体につき①または②を1回起動する' },
    { title: 'ダメージを与える相手Ob', phrase: '②相手のOb一体に3ダメージを与える' }
  ],
  'STD-193': [{ phrase: '自分と相手のOb1体ずつを選び破壊できる' }],
  'STD-203': [
    { stage: 0, phrase: '自分のOb1体を破壊し' },
    { stage: 1, phrase: '相手Ob1体に2ダメージ' }
  ]
};

// Sentences of the text, split at 。 outside brackets so keyword notes stay whole.
export function effectClauses(text) {
  const clauses = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if ('（(「『['.includes(char)) depth++;
    else if ('）)」』]'.includes(char)) depth = Math.max(0, depth - 1);
    else if (char === '。' && depth === 0) { clauses.push({ start, end: index + 1 }); start = index + 1; }
  }
  if (start < text.length) clauses.push({ start, end: text.length });
  return clauses;
}

const bigrams = text => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)));
const TARGET_WORDS = /(\d+|X|一|好きな数)(体|枚)|選/;

// The span of the text the current pick resolves, or null when nothing fits.
export function effectFocus(definitionId, text, request, stage = null) {
  if (!text || !request) return null;
  const rule = (FLOW_PHRASES[definitionId] ?? []).find(item => (item.key === undefined || item.key === request.presentationKey)
    && (item.title === undefined || request.title?.includes(item.title))
    && (item.stage === undefined || item.stage === stage?.index) && text.includes(item.phrase));
  if (rule) { const start = text.indexOf(rule.phrase); return { start, end: start + rule.phrase.length }; }
  const clauses = effectClauses(text);
  const title = request.title && request.title !== presentationLabel(request.presentationKey) ? request.title : null;
  if (title) {
    const wanted = bigrams(title);
    const scored = clauses.map(clause => [...bigrams(text.slice(clause.start, clause.end))].filter(pair => wanted.has(pair)).length);
    const best = Math.max(0, ...scored);
    if (best >= 2) return clauses[scored.indexOf(best)];
  }
  return clauses.find(clause => TARGET_WORDS.test(text.slice(clause.start, clause.end))) ?? null;
}

// Clauses before the focus read as resolved, the focused phrase is lit, the rest waits.
export function effectTextHtml(text, focus) {
  return effectClauses(text).map(clause => {
    const body = text.slice(clause.start, clause.end);
    if (!focus || clause.end <= focus.start) return `<span class="flow-clause${focus ? ' is-done' : ''}">${esc(body)}</span>`;
    if (clause.start >= focus.end) return `<span class="flow-clause is-next">${esc(body)}</span>`;
    const from = Math.max(focus.start, clause.start) - clause.start, to = Math.min(focus.end, clause.end) - clause.start;
    return `<span class="flow-clause is-now">${esc(body.slice(0, from))}<mark>${esc(body.slice(from, to))}</mark>${esc(body.slice(to))}</span>`;
  }).join('');
}

// Where a floating flow panel covers the least of the pick's targets: the top-left corner
// when it is clear, otherwise sliding along the top and left edges, then the other corners.
export function placeFlow(panel, obstacles, viewport, margin = 12) {
  const x0 = margin, y0 = margin;
  const x1 = Math.max(x0, viewport.width - panel.width - margin), y1 = Math.max(y0, viewport.height - panel.height - margin);
  const candidates = [{ left: x0, top: y0 }];
  for (let left = x0 + 40; left < x1; left += 40) candidates.push({ left, top: y0 });
  for (let top = y0 + 40; top < y1; top += 40) candidates.push({ left: x0, top });
  candidates.push({ left: x1, top: y0 }, { left: x0, top: y1 }, { left: x1, top: y1 });
  const overlap = pos => obstacles.reduce((sum, rect) => sum
    + Math.max(0, Math.min(pos.left + panel.width, rect.right + 4) - Math.max(pos.left, rect.left - 4))
    * Math.max(0, Math.min(pos.top + panel.height, rect.bottom + 4) - Math.max(pos.top, rect.top - 4)), 0);
  let best = null;
  for (const pos of candidates) {
    const area = overlap(pos);
    if (!best || area < best.area) best = { ...pos, area };
    if (area === 0) break;
  }
  return best;
}
