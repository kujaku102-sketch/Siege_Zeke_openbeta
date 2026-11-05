import { pickBadgeShape } from './wireframe/board-view.js';

// The opening (rulebook 2.4; 文豪, 2026-11-05: 「CPU戦でもマリガン経路は入れる」): before the first turn each user, one at a
// time, keeps the hand or returns any number of cards under the deck and draws as many (once; BIGBOSS up to three times),
// then dice decide who goes first. The flow and the handling follow Shadowverse's (the hand laid out in the middle, a card
// dragged up or tapped to return, one button); the look is the match's own parts (文豪: 「見た目は盤面の選択画面や設定と同じ部品を
// 使おう」): the window's backdrop, the board pick's bar with its title and button, cards lit as targets and marked as picked,
// and the board's 「マウント」 tag reading 「戻す」. DOM-free.

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const typeOf = action => action?.actionType ?? action?.action?.type ?? null;
// BIGBOSS (watching_you) may redraw up to three times; everyone else once (core/opening.js).
export const openingRedrawLimit = user => user?.abilityKey === 'watching_you' ? 3 : 1;

// Where the opening stands for the viewer: null once a turn has been taken (or in a match that starts without it);
// 'mine' while the viewer decides (with the keep and redraw actions), 'waiting' while the other user does.
export function openingPhase(model) {
  if (!model?.match || model.match.finished || !model.seats.every(seat => seat.turnsTaken === 0)) return null;
  const keep = model.legalActions.find(action => typeOf(action) === 'keepOpeningHand');
  if (!keep) return { phase: 'waiting' };
  const redraw = model.legalActions.find(action => typeOf(action) === 'openingMulligan');
  return { phase: 'mine', keepId: keep.actionId, redrawId: redraw?.actionId ?? null };
}

// The window's backdrop (.r2-modal), on its own so its text rules stay off the cards, and the board pick's bar
// (runtime-read-view.js, .board-pick-guide): its title, a short note, its buttons.
const backdrop = '<div class="r2-modal" aria-hidden="true"></div>';
const bar = (title, rest = '', attrs = '') => `<aside class="board-pick-guide" role="status"${attrs}><strong>${title}</strong>${rest}</aside>`;
const badge = `<svg class="r2-opening-badge" viewBox="-60 -20 120 40" aria-hidden="true"><g class="wf-pick-badge">${pickBadgeShape('戻す')}</g></svg>`;

// The dice's answer, shown once the opening is over: who takes the first turn, as the viewer reads it.
const firstHtml = (first, viewerSeat) => !first ? ''
  : bar(`ダイス：<b>${first === viewerSeat ? '先攻' : '後攻'}</b>`, `<span>${first === viewerSeat ? 'あなたから始めます' : '相手から始めます'}</span>`, ` data-opening-first="${first === viewerSeat ? 'you' : 'opponent'}"`);

// `opening`: the surface's own state, { marks: cardRefs, fresh: cardRefs just drawn, used: redraws made, first: seat }.
// `cardHtml(card, { lit, picked })`: a hand card drawn as a picture (no control of its own), lit as a target and marked as picked.
export function openingHtml(model, opening = {}, { cardHtml }) {
  const phase = openingPhase(model);
  if (!phase) return firstHtml(opening.first, model.match.viewerSeat);
  const viewer = model.seats.find(seat => seat.seatId === model.match.viewerSeat);
  const cards = viewer?.hand.cards ?? [];
  const fresh = new Set(opening.fresh ?? []);
  const row = items => `<div class="r2-opening-hand" style="--count:${cards.length}">${items}</div>`;
  if (phase.phase === 'waiting') {
    return `<div class="r2-opening is-waiting" aria-label="開始手札">${backdrop}${bar('相手が手札を決めています…')}`
      + row(cards.map((card, index) => `<div class="r2-opening-card${fresh.has(card.cardRef) ? ' is-new' : ''}" style="--i:${index}">${cardHtml(card)}</div>`).join('')) + '</div>';
  }
  const marks = new Set(opening.marks ?? []);
  const count = cards.filter(card => marks.has(card.cardRef)).length;
  const limit = openingRedrawLimit(viewer.user), left = Math.max(0, limit - (opening.used ?? 0));
  const redraw = count && phase.redrawId;
  return `<div class="r2-opening" role="dialog" aria-modal="true" aria-label="開始手札" data-opening="mine">${backdrop}`
    + bar('開始手札：<b>戻すカードを選択</b>', `${limit > 1 ? `<span>引き直し あと${left}回</span>` : ''}<button data-opening-decide>${redraw ? `${count}枚引き直す` : 'キープ'}</button>`)
    + row(cards.map((card, index) => {
      const marked = marks.has(card.cardRef), name = card.faceDown ? '裏向きカード' : card.definition.name;
      return `<button class="r2-opening-card${marked ? ' is-marked' : ''}${fresh.has(card.cardRef) ? ' is-new' : ''}" data-opening-card="${esc(card.cardRef)}" aria-pressed="${marked}" aria-label="${esc(name)}${marked ? '（戻す）' : ''}" style="--i:${index}">${cardHtml(card, { lit: true, picked: marked })}${marked ? badge : ''}</button>`;
    }).join('')) + '</div>';
}
