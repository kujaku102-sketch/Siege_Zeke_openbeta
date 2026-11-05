// The opening (rulebook 2.4; 文豪, 2026-11-05: 「CPU戦でもマリガン経路は入れる」): before the first turn each user, one at a
// time, keeps the hand or returns any number of cards under the deck and draws as many (once; BIGBOSS up to three times),
// then dice decide who goes first. The opening hand lies large in the middle; a card marked to return (an upward drag or a
// tap) rises and wears 「戻す」; the one button keeps the hand or redraws the marked cards. DOM-free.

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

// The dice's answer, shown once the opening is over: who takes the first turn, as the viewer reads it.
const firstHtml = (first, viewerSeat) => !first ? '' : `<aside class="r2-opening-first is-${first === viewerSeat ? 'you' : 'opponent'}" role="status" aria-live="polite">`
  + `<small>ダイス</small><b>${first === viewerSeat ? '先攻' : '後攻'}</b><span>${first === viewerSeat ? 'あなたから始めます' : '相手から始めます'}</span></aside>`;

// `opening`: the surface's own state, { marks: cardRefs, fresh: cardRefs just drawn, used: redraws made, first: seat }.
// `cardHtml(card)`: a hand card drawn as a picture (no control of its own).
export function openingHtml(model, opening = {}, { cardHtml }) {
  const phase = openingPhase(model);
  if (!phase) return firstHtml(opening.first, model.match.viewerSeat);
  const viewer = model.seats.find(seat => seat.seatId === model.match.viewerSeat);
  const cards = viewer?.hand.cards ?? [];
  const fresh = new Set(opening.fresh ?? []);
  if (phase.phase === 'waiting') {
    return `<section class="r2-opening is-waiting" role="status" aria-live="polite" aria-label="開始手札"><h2>相手が手札を決めています…</h2>`
      + `<div class="r2-opening-hand" style="--count:${cards.length}">${cards.map((card, index) => `<div class="r2-opening-card${fresh.has(card.cardRef) ? ' is-new' : ''}" style="--i:${index}">${cardHtml(card)}</div>`).join('')}</div></section>`;
  }
  const marks = new Set(opening.marks ?? []);
  const count = cards.filter(card => marks.has(card.cardRef)).length;
  const limit = openingRedrawLimit(viewer.user), left = Math.max(0, limit - (opening.used ?? 0));
  const note = limit > 1 ? `<p class="r2-opening-left">引き直し あと${left}回</p>` : '';
  const redraw = count && phase.redrawId;
  return `<section class="r2-opening" role="dialog" aria-modal="true" aria-labelledby="r2-opening-title" data-opening="mine">`
    + `<header><h2 id="r2-opening-title">開始手札</h2><p>戻すカードを上へ動かすか押す。戻した枚数だけ引き直す。</p>${note}</header>`
    + `<div class="r2-opening-hand" style="--count:${cards.length}">${cards.map((card, index) => {
      const marked = marks.has(card.cardRef), name = card.faceDown ? '裏向きカード' : card.definition.name;
      return `<button class="r2-opening-card${marked ? ' is-marked' : ''}${fresh.has(card.cardRef) ? ' is-new' : ''}" data-opening-card="${esc(card.cardRef)}" aria-pressed="${marked}" aria-label="${esc(name)}${marked ? '（戻す）' : ''}" style="--i:${index}">${cardHtml(card)}${marked ? '<span class="r2-opening-tag">戻す</span>' : ''}</button>`;
    }).join('')}</div>`
    + `<footer><button class="r2-opening-decide${redraw ? ' is-redraw' : ''}" data-opening-decide>${redraw ? `${count}枚引き直す` : 'キープ'}</button></footer></section>`;
}
