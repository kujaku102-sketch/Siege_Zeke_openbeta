import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeLogHtml, runtimeLogBodyHtml, runtimeActivationHtml, activationSide, runtimeThreadItemHtml } from '../src/ui-refresh/runtime-log-view.js';

const sam = { kind: 'card', cardRef: 'r1', faceDown: false, definitionId: 'STD-077', name: 'ジャンカー・サム' };
const mika = { kind: 'card', cardRef: 'r2', faceDown: false, definitionId: 'STD-084', name: '汎用戦闘装甲ミカヅキ' };
const events = [
  { eventId: 'e1', commandId: 'c1', type: 'action_committed', actionType: 'install', turnNumber: 3, actorSeat: 'seat-a', source: sam },
  { eventId: 'e2', commandId: 'c2', type: 'combat_resolved', turnNumber: 3, actorSeat: 'seat-a', source: sam, target: mika,
    damage: 3, counterDamage: 1, targetStrBefore: 5, targetStrAfter: 2, sourceStrBefore: 4, sourceStrAfter: 3 },
  { eventId: 'e3', commandId: 'c3', type: 'user_damaged', turnNumber: 4, actorSeat: 'seat-b', source: mika,
    target: { kind: 'user', seatId: 'seat-a' }, amount: 4, before: 20, after: 16 },
  { eventId: 'e4', commandId: 'c4', type: 'card_destroyed', turnNumber: 4, actorSeat: 'seat-b', target: sam }
];

test('battle log puts own rows left and opponent rows right with tags and number badges', () => {
  const html = runtimeLogHtml(events, 'seat-a');
  assert.match(html, /BATTLE RECORD/);
  assert.match(html, /<div class="r2-log-turn is-you"><b>TURN 03<\/b>YOU<\/div>/);
  assert.match(html, /<div class="r2-log-turn is-opponent"><b>TURN 04<\/b>OPPONENT<\/div>/);
  assert.match(html, /class="r2-log-entry is-you" data-event-id="e1"[^]*INSTALL[^]*YOU · ジャンカー・サム[^]*<p>インストール<\/p>/);
  assert.match(html, /class="r2-log-entry is-you is-dmg" data-event-id="e2"[^]*<b>3 DMG<\/b><b class="is-str">対象 STR <s>5<\/s>→2<\/b><b>反撃 1 DMG<\/b>/);
  assert.match(html, /class="r2-log-entry is-opponent is-dmg" data-event-id="e3"[^]*<p>→ 自分のユーザー<\/p>[^]*<b class="is-str">STR <s>20<\/s>→16<\/b>/);
  assert.match(html, /class="r2-log-entry is-opponent is-brk" data-event-id="e4"[^]*BREAK[^]*ジャンカー・サム 破壊/);
  assert.match(runtimeLogHtml([], 'seat-a'), /<div class="r2-log-scroll"><p>行動はまだない<\/p><\/div>/);
});

test('the turn divider follows who started the turn and a drawn card stays on its owner side', () => {
  const html = runtimeLogHtml([
    { eventId: 'x1', commandId: 'c1', type: 'action_committed', actionType: 'endTurn', turnNumber: 2, actorSeat: 'seat-a' },
    { eventId: 'x2', commandId: 'c1', type: 'turn_started', turnNumber: 2, actorSeat: 'seat-b' },
    { eventId: 'x3', commandId: 'c1', type: 'card_moved', turnNumber: 2, actorSeat: 'seat-b', source: null, target: sam,
      from: { kind: 'unobserved' }, to: { kind: 'zone', seatId: 'seat-a', zone: 'hand' } }
  ], 'seat-a');
  assert.match(html, /<div class="r2-log-turn is-opponent"><b>TURN 02<\/b>OPPONENT<\/div>/);
  // Turn change rows belong to neither side and carry no card icon.
  assert.match(html, /<article class="r2-log-entry is-system" data-event-id="x1"[^>]*><div class="r2-log-body">[^]*END[^]*YOU/);
  assert.match(html, /<article class="r2-log-entry is-system" data-event-id="x2"[^>]*><div class="r2-log-body">[^]*ターン開始/);
  assert.match(html, /class="r2-log-entry is-you" data-event-id="x3"[^]*<p>「ジャンカー・サム」を手札に加える。<\/p>/);
});

test('a command nests its follow-ups without icons', () => {
  const body = runtimeLogBodyHtml([
    { eventId: 'a1', commandId: 'c1', type: 'action_committed', actionType: 'attack', turnNumber: 1, actorSeat: 'seat-a', source: sam },
    { eventId: 'a2', commandId: 'c1', type: 'attack_declared', turnNumber: 1, actorSeat: 'seat-a', source: sam, target: mika },
    { eventId: 'a3', commandId: 'c2', type: 'action_committed', actionType: 'install', turnNumber: 1, actorSeat: 'seat-a', source: sam }
  ], 'seat-a', new Set(['a3']));
  assert.match(body, /<article class="r2-log-entry is-you" data-event-id="a1"[^>]*><span class="r2-log-card-icon">/);
  // The attack target sits one step in, with no icon and no repeated YOU · name.
  assert.match(body, /<article class="r2-log-entry is-you is-child" data-event-id="a2"[^>]*><div class="r2-log-body"><div class="r2-log-head"><span class="r2-log-tag">ATTACK<\/span><\/div><p>→ 汎用戦闘装甲ミカヅキ 攻撃宣言<\/p>/);
  assert.match(body, /<article class="r2-log-entry is-you is-new" data-event-id="a3"[^>]*><span class="r2-log-card-icon">/);
});

test('a trigger thread is one box: THREAD n and the card, the keyword clause, then what it did', () => {
  const hana = { kind: 'card', cardRef: 'r3', faceDown: false, definitionId: 'STD-131', name: '「華守り」' };
  const hanaB = { ...hana, cardRef: 'r4' };
  const items = [{ threadItemId: 'T:0', controllerSeat: 'seat-b', card: hanaB, timing: 'logout' },
    { threadItemId: 'T:1', controllerSeat: 'seat-a', card: hana, timing: 'logout' }];
  const moved = (id, item, seat, card) => ({ eventId: id, commandId: 'c2', type: 'card_moved', threadId: 'T', threadItemId: item, turnNumber: 1,
    actorSeat: seat, source: card, target: card, from: { kind: 'zone', seatId: seat, zone: 'hand' }, to: { kind: 'board', seatId: seat, zone: 'front' } });
  const body = runtimeLogBodyHtml([
    { eventId: 't1', commandId: 'c1', type: 'thread_started', threadId: 'T', items, turnNumber: 1, actorSeat: 'seat-a' },
    { eventId: 't2a', commandId: 'c2', type: 'action_committed', actionType: 'answerChoice', threadId: 'T', threadItemId: 'T:1', turnNumber: 1, actorSeat: 'seat-a' },
    moved('t2', 'T:1', 'seat-a', { ...hana, cardRef: 'r5' }),
    { eventId: 't2b', commandId: 'c2', type: 'choice_required', threadId: 'T', threadItemId: 'T:1', turnNumber: 1, actorSeat: 'seat-a', choiceId: 'in' },
    moved('t3', 'T:0', 'seat-b', { ...hana, cardRef: 'r6' }),
    { eventId: 't4', commandId: 'c3', type: 'thread_resolved', threadId: 'T', turnNumber: 1, actorSeat: 'seat-b' },
    { eventId: 't5', commandId: 'c4', type: 'choice_required', turnNumber: 1, actorSeat: 'seat-a', choiceId: 'k' }
  ], 'seat-a');
  // No explanation rows: the box opens straight into the first trigger, numbered by resolve order.
  assert.match(body, /<section class="r2-log-thread" aria-label="スレッド"><div class="r2-log-thread-item is-you"><span class="r2-log-thread-no">THREAD1<\/span><strong>「華守り」<\/strong><\/div><p class="r2-log-thread-effect is-you"><img class="r2-log-kw" src="[^"]*logout\.png" alt="ログアウト">：「華守り」1体を手札からドラッグする。<em>起動！<\/em><\/p><article class="r2-log-entry is-you is-child" data-event-id="t2"[^]*<p>→手札から「華守り」をフロントへ配置。<\/p>/);
  assert.match(body, /<div class="r2-log-thread-item is-opponent"><span class="r2-log-thread-no">THREAD2<\/span><strong>「華守り」<\/strong><\/div><p class="r2-log-thread-effect is-opponent">[^]*<article class="r2-log-entry is-opponent is-child" data-event-id="t3"/);
  assert.doesNotMatch(body, /data-event-id="(t1|t2a|t2b|t4)"|対象確定|同時誘発|スレッド解決/);
  // The box closes at its resolution; a later choice is a plain centre row outside it.
  assert.match(body, /<\/article><\/section><article class="r2-log-entry is-system" data-event-id="t5"[^]*CHOICE/);
});

test('activation callout reuses the log row for either side\'s card actions', () => {
  const commit = (actionType, actorSeat, source = mika) => ({ eventId: `k-${actionType}`, commandId: 'c9', type: 'action_committed', actionType, turnNumber: 2, actorSeat, source });
  const html = runtimeActivationHtml(commit('executeCard', 'seat-b'), 'seat-a');
  assert.match(html, /^<article class="r2-log-entry is-opponent"/);
  assert.match(html, /<span class="r2-log-tag">EXEC<\/span><strong>OPP · 汎用戦闘装甲ミカヅキ<\/strong>/);
  assert.match(html, /<p>実行<\/p>/);
  assert.match(runtimeActivationHtml(commit('setScript', 'seat-b', { kind: 'card', cardRef: 'r3', faceDown: true }), 'seat-a'), /OPP · 裏向きカード/);
  assert.match(runtimeActivationHtml(commit('executeCard', 'seat-a'), 'seat-a'), /^<article class="r2-log-entry is-you"[^]*<strong>YOU · 汎用戦闘装甲ミカヅキ<\/strong>/);
  assert.equal(activationSide(commit('executeCard', 'seat-a'), 'seat-a'), 'you');
  assert.equal(activationSide(commit('install', 'seat-b'), 'seat-a'), 'opponent');
  assert.equal(activationSide(commit('attack', 'seat-a'), 'seat-a'), '');
  assert.equal(runtimeActivationHtml(commit('attack', 'seat-b'), 'seat-a'), '');
  assert.equal(runtimeActivationHtml(commit('endTurn', 'seat-b', undefined), 'seat-a'), '');
});

test('a thread item for the callout stack carries its number, side, card and effect', () => {
  const hana = { kind: 'card', cardRef: 'r3', faceDown: false, definitionId: 'STD-131', name: '「華守り」' };
  const mine = runtimeThreadItemHtml({ threadItemId: 'T:1', controllerSeat: 'seat-a', card: hana, timing: 'logout' }, 2, 'seat-a');
  assert.match(mine, /^<b class="r2-log-thread-no">Tr2<\/b><article class="r2-log-entry is-you" data-thread-item="T:1">/);
  assert.match(mine, /<span class="r2-log-tag">ログアウト<\/span><strong>YOU · 「華守り」<\/strong>/);
  assert.match(mine, /class="r2-log-thread-effect is-you"[^]*起動！/);
  const theirs = runtimeThreadItemHtml({ threadItemId: 'T:0', controllerSeat: 'seat-b', card: { ...hana, faceDown: true }, timing: 'logout' }, 1, 'seat-a');
  assert.match(theirs, /is-opponent[^]*OPP · 裏向きカード/);
  assert.doesNotMatch(theirs, /起動！/);
});

test('opening decisions are named: own keep, own redraw, and the opponent decision without its content', () => {
  const html = runtimeLogHtml([
    { eventId: 'o1', commandId: 'c1', type: 'action_committed', actionType: 'keepOpeningHand', turnNumber: 1, actorSeat: 'seat-a' },
    { eventId: 'o2', commandId: 'c2', type: 'action_committed', actionType: 'openingDecision', turnNumber: 1, actorSeat: 'seat-b' }
  ], 'seat-a');
  const row = id => html.split('<article').find(part => part.includes('data-event-id="' + id + '"')) ?? '';
  assert.ok(row('o1').includes('>KEEP<') && row('o1').includes('<p>キープ</p>'));
  assert.ok(row('o2').includes('>OPENING<') && row('o2').includes('<p>開始手札の決定</p>'));
  assert.ok(!html.includes('keepOpeningHand') && !html.includes('openingDecision') && !html.includes('>ACTION<'));
});

test('opening rows sit under their own divider and the first turn starts its own after the last decision', () => {
  const html = runtimeLogHtml([
    { eventId: 'p1', commandId: 'c1', type: 'action_committed', actionType: 'openingMulligan', turnNumber: 1, actorSeat: 'seat-a' },
    { eventId: 'p2', commandId: 'c1', type: 'card_moved', turnNumber: 1, actorSeat: 'seat-a', source: sam, target: sam, from: { kind: 'zone', seatId: 'seat-a', zone: 'hand' }, to: { kind: 'unobserved' } },
    { eventId: 'p3', commandId: 'c2', type: 'action_committed', actionType: 'openingDecision', turnNumber: 1, actorSeat: 'seat-b' },
    { eventId: 'p4', commandId: 'c2', type: 'turn_started', turnNumber: 1, actorSeat: 'seat-b' },
    { eventId: 'p5', commandId: 'c2', type: 'card_moved', turnNumber: 1, actorSeat: 'seat-b', target: mika, from: { kind: 'unobserved' }, to: { kind: 'zone', seatId: 'seat-b', zone: 'hand' } }
  ], 'seat-a');
  const at = text => html.indexOf(text);
  assert.ok(at('OPENING</b>') >= 0 && at('OPENING</b>') < at('data-event-id="p1"'));
  assert.ok(at('data-event-id="p3"') < at('TURN 01'), 'the decisions come before the first turn divider');
  assert.ok(at('TURN 01') < at('data-event-id="p4"') && at('data-event-id="p4"') < at('data-event-id="p5"'));
  assert.equal(html.split('class="r2-log-turn').length - 1, 2, 'one OPENING divider and one TURN divider');
});
