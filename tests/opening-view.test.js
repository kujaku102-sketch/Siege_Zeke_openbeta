// the opening screen of a CPU or online match (rulebook 2.4; 文豪, 2026-11-05), drawn in
// the match's own parts (the window, the board pick's bar, lit and picked cards, the board's tag).
// decks are deck ids, users are user ids, cards are found by what the match deals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { createMatchUiController } from '../src/adapters/match-ui-controller.js';
import { openingHtml, openingPhase, openingRedrawLimit } from '../src/ui-refresh/opening-view.js';
import { createOpeningInput } from '../src/ui-refresh/surface-opening.js';
import { runtimeGameHtml } from '../src/ui-refresh/runtime-read-view.js';
import { pickBadgeShape } from '../src/ui-refresh/wireframe/board-view.js';

function match({ opening = 'v2.4', playerUserId = 'doors_zx', seed = 5 } = {}) {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: { matchId: 'opening', seatIds: ['player', 'ai'], seed, ruleVersion: '2.0', cardVersion: 'public',
    gameOptions: { mode: 'ai', ...(opening ? { openingProtocol: opening } : {}), playerDeckId: 'start-red', aiDeckId: 'start-yellow', playerUserId, aiUserId: 'doors_zx' } } });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.value;
}
const reader = (session, seat) => createMatchUiController({ session, viewerSeat: seat }).value;
const picture = (card, { lit = false, picked = false } = {}) => `<i data-card="${card.cardRef}"${lit ? ' data-lit' : ''}${picked ? ' data-picked' : ''}></i>`;
const handOf = model => model.seats.find(seat => seat.seatId === model.match.viewerSeat).hand.cards.map(card => card.cardRef);
const count = (html, pattern) => (html.match(pattern) ?? []).length;

test('the opening is told from the board: the viewer decides, the other waits, and a match started the old way has none', () => {
  const session = match();
  const mine = openingPhase(reader(session, 'player').read().value.model);
  assert.equal(mine.phase, 'mine');
  assert.ok(mine.keepId && mine.redrawId);
  assert.deepEqual(openingPhase(reader(session, 'ai').read().value.model), { phase: 'waiting' });
  assert.equal(openingPhase(reader(match({ opening: null }), 'player').read().value.model), null);
});

test('the opening screen in the match\'s own parts: the window, the pick bar with one button, lit cards, the board\'s tag reading 「戻す」', () => {
  const read = reader(match(), 'player').read().value, hand = handOf(read.model);
  const plain = openingHtml(read.model, {}, { cardHtml: picture });
  assert.ok(plain.startsWith('<div class="r2-opening" role="dialog" aria-modal="true" aria-label="開始手札" data-opening="mine"><div class="r2-modal" aria-hidden="true"></div>'
    + '<aside class="board-pick-guide" role="status"><strong>開始手札：<b>戻すカードを選択</b></strong><button data-opening-decide>キープ</button></aside>'), plain.slice(0, 300));
  assert.equal(count(plain, /data-opening-card="/g), hand.length);
  assert.equal(count(plain, / data-lit>/g), hand.length, 'every card lit as a target');
  assert.equal(count(plain, /あと\d回|data-picked/g), 0, 'one redraw: no count; nothing picked');
  const marked = openingHtml(read.model, { marks: hand.slice(0, 2) }, { cardHtml: picture });
  assert.equal(count(marked, /class="r2-opening-card is-marked"/g), 2);
  assert.equal(count(marked, / data-picked>/g), 2, 'picked as on the board');
  // The board's 「マウント」 tag, the same shape, reading 「戻す」.
  assert.equal(marked.split(`<g class="wf-pick-badge">${pickBadgeShape('戻す')}</g>`).length - 1, 2);
  assert.ok(marked.includes(`data-opening-card="${hand[0]}" aria-pressed="true"`));
  assert.ok(marked.includes('<button data-opening-decide>2枚引き直す</button>'));
  // The board's own キープ / 引き直し buttons give way to the screen; the real card picture is lit and picked as on the board.
  const board = runtimeGameHtml(read.model, { ...read, view: 'pc', boardStyle: 'wireframe', effectsEnabled: false, opening: { marks: hand.slice(0, 1) } });
  assert.doesNotMatch((board.split('wf-extra-actions')[1] ?? '').split('</div>')[0], /キープ|引き直し/);
  const region = board.split('<div data-live-region="opening" class="r2-region-host r2-region-opening">')[1] ?? '';
  assert.ok(region.startsWith('<div class="r2-opening" role="dialog"'));
  assert.equal(count(region, /<span class="card request-target selected color-/g), 1);
  assert.equal(count(region, /<span class="card request-target color-/g), hand.length - 1);
  assert.doesNotMatch(region, /data-card-ref=/, 'the pictures carry no card control of their own');
});

test('waiting for the other user, and the dice\'s answer once the opening is over, on the pick bar', () => {
  const session = match();
  const waiting = openingHtml(reader(session, 'ai').read().value.model, {}, { cardHtml: picture });
  assert.ok(waiting.startsWith('<div class="r2-opening is-waiting" aria-label="開始手札"><div class="r2-modal" aria-hidden="true"></div><aside class="board-pick-guide" role="status"><strong>相手が手札を決めています…</strong></aside>'));
  assert.equal(count(waiting, /data-opening-decide|<button|data-lit/g), 0);
  const started = reader(match({ opening: null }), 'player').read().value.model;
  assert.equal(openingHtml(started, { first: 'player' }, { cardHtml: picture }), '<aside class="board-pick-guide" role="status" data-opening-first="you"><strong>ダイス：<b>先攻</b></strong><span>あなたから始めます</span></aside>');
  assert.equal(openingHtml(started, { first: 'ai' }, { cardHtml: picture }), '<aside class="board-pick-guide" role="status" data-opening-first="opponent"><strong>ダイス：<b>後攻</b></strong><span>相手から始めます</span></aside>');
  assert.equal(openingHtml(started, {}, { cardHtml: picture }), '');
});

test('BIGBOSS redraws up to three times and the bar counts them down', () => {
  const read = reader(match({ playerUserId: 'bigboss' }), 'player').read().value;
  const viewer = read.model.seats.find(seat => seat.seatId === 'player');
  assert.equal(openingRedrawLimit(viewer.user), 3);
  assert.ok(openingHtml(read.model, {}, { cardHtml: picture }).includes('</strong><span>引き直し あと3回</span><button data-opening-decide>'));
  assert.ok(openingHtml(read.model, { used: 1 }, { cardHtml: picture }).includes('<span>引き直し あと2回</span>'));
});

test('the one button: nothing marked keeps the hand; marked cards are returned and as many drawn, then the other user decides', () => {
  const quiet = { addEventListener() {}, removeEventListener() {} };
  const run = (marks) => {
    const session = match(), ui = reader(session, 'player');
    let latest = ui.read().value;
    const act = result => { if (result.ok) latest = result.value; return result; };
    const opening = createOpeningInput({ root: quiet, ui, act, latest: () => latest, schedule: () => {}, motion: () => false });
    const before = handOf(latest.model);
    for (const ref of before.slice(0, marks)) opening.toggle(ref);
    opening.decide();
    const after = reader(session, 'player').read().value.model;
    opening.dispose();
    return { before, after: handOf(after), active: after.match.activeSeat, phase: openingPhase(after) };
  };
  const kept = run(0);
  assert.deepEqual(kept.after, kept.before, 'kept as dealt');
  assert.equal(kept.active, 'ai');
  assert.deepEqual(kept.phase, { phase: 'waiting' });
  const redrawn = run(2);
  assert.equal(redrawn.after.length, redrawn.before.length);
  assert.equal(redrawn.after.filter(ref => !redrawn.before.includes(ref)).length, 2, 'two returned, two drawn');
  assert.equal(redrawn.active, 'ai', 'one redraw ends the decision');
});

test("the dice's answer holds the first move: the match counts it as motion until it is gone", () => {
  const quiet = { addEventListener() {}, removeEventListener() {} }, cleared = [];
  const session = match(), ui = reader(session, 'player');
  const opening = createOpeningInput({ root: quiet, ui, act: result => result, latest: () => null, schedule: (task, ms) => cleared.push(ms), motion: () => false });
  const during = ui.read().value;
  assert.equal(opening.observe(during).first, null);
  assert.equal(opening.holdRemaining(), 0, 'no hold during the opening itself');
  const after = reader(match({ opening: null }), 'player').read().value;
  const view = opening.observe({ ...after, events: [{ type: 'turn_started', actorSeat: 'ai' }] });
  assert.equal(view.first, 'ai', "the first turn's start names who won the dice");
  const left = opening.holdRemaining();
  assert.ok(left > 0 && left <= 2400, String(left));
  assert.deepEqual(cleared, [2400], 'the line goes after 2.4 s at the effect speed ×1');
  opening.dispose();
});

test("a name that wraps is set to fit the name band's two lines on the opening screen; a short one keeps its own size", () => {
  const read = reader(match(), 'player').read().value;
  const card = read.model.seats.find(seat => seat.seatId === 'player').hand.cards[0];
  const region = name => runtimeGameHtml({ ...read.model, seats: read.model.seats.map(seat => seat.seatId !== 'player' ? seat
    : { ...seat, hand: { ...seat.hand, cards: [{ ...card, definition: { ...card.definition, name } }] } }) }, { ...read, view: 'pc', boardStyle: 'wireframe', effectsEnabled: false, opening: {} })
    .split('r2-region-opening')[1];
  assert.match(region('短い名前'), /<strong class="card-name">短い名前<\/strong>/);
  const size = name => Number(region(name).match(/<strong class="card-name" style="font-size:calc\(var\(--u\) \* ([\d.]+)\)">/)?.[1]);
  assert.equal(size('ちょうど二行になるくらいの名前'), .49, 'two lines: at most .49 of the unit');
  const long = size('とてもとても長い名前（ながいなまえ）・ふたつめの名前');
  assert.ok(long < .49 && long > .3, String(long));
});
