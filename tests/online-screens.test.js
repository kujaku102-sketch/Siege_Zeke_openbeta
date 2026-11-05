// the online screens and what an online match adds (design §14.1), DOM-free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { typedRoomCode, onlineEntryHtml, onlineJoinHtml, onlineRoomHtml, onlineHudHtml, onlineResultReason, onlineErrorText, secondsLeft } from '../src/ui-refresh/online-screens-view.js';
import { runtimeResultHtml } from '../src/ui-refresh/runtime-log-view.js';
import { battleSetupHtml } from '../src/ui-refresh/flow-screens-view.js';
import { SCREENS, nextScreen, isFlowScreen, escapeScreen } from '../src/ui-refresh/screen-flow.js';

const options = { deckOptions: id => `<option value="${id}" selected>${id}</option>`, userOptions: id => `<option value="${id}" selected>${id}</option>` };
const NOW = 1_000_000;

test('a typed room code reads as the room\'s letters: wide or lower case, spaces and hyphens dropped, the hyphen after the fourth', () => {
  assert.equal(typedRoomCode('k7m2qx9d'), 'K7M2-QX9D');
  assert.equal(typedRoomCode('Ｋ７Ｍ２ ｑｘ９ｄ'), 'K7M2-QX9D');
  assert.equal(typedRoomCode(' k7m2-qx9d '), 'K7M2-QX9D');
  // Letters a code never uses (I, O, 0, 1) stay out; nothing past eight letters.
  assert.equal(typedRoomCode('IO01k7m2qx9dZZ'), 'K7M2-QX9D');
  assert.equal(typedRoomCode('k7m'), 'K7M');
});

test('the online flow: setup opens the door, the door the code or the room, the room starts the match; each comes back', () => {
  for (const name of ['online-entry', 'online-join', 'online-room']) { assert.ok(SCREENS.includes(name)); assert.equal(isFlowScreen(name), true); }
  assert.equal(nextScreen('battle-setup', 'open-online'), 'online-entry');
  assert.equal(nextScreen('online-entry', 'open-join'), 'online-join');
  assert.equal(nextScreen('online-entry', 'room'), 'online-room');
  assert.equal(nextScreen('online-join', 'room'), 'online-room');
  assert.equal(nextScreen('online-room', 'start'), 'game');
  assert.equal(escapeScreen('online-room'), 'online-entry');
  assert.equal(escapeScreen('online-join'), 'online-entry');
  assert.equal(escapeScreen('online-entry'), 'battle-setup');
});

test('battle setup offers online play only where a server is set', () => {
  const host = { playerDeckId: 'a', aiDeckId: 'b', playerUserId: 'u', aiUserId: 'u' };
  assert.ok(battleSetupHtml(host, options).includes('<button class="r2-flow-online" data-online-battle aria-disabled="true">オンライン対戦<small>準備中</small></button>'));
  const open = battleSetupHtml({ ...host, online: { available: true } }, options);
  assert.ok(open.includes('<button class="r2-flow-online" data-flow="open-online">オンライン対戦</button>'));
  assert.doesNotMatch(open, /準備中/);
});

test('the door: a guest name, the deck and user, two ways in; without a server both are shut', () => {
  const host = { playerDeckId: 'start-red', playerUserId: 'doors_zx' };
  const shut = onlineEntryHtml({ ...host, online: { available: false, name: '' } }, options);
  assert.match(shut, /サーバーは準備中です/);
  assert.match(shut, /<button class="r2-flow-primary" data-online-create aria-disabled="true" data-busy>部屋を作る<\/button>/);
  assert.match(shut, /<button data-flow="open-join" aria-disabled="true" data-busy>コードで入る<\/button>/);
  const open = onlineEntryHtml({ ...host, online: { available: true, name: '<あ>' } }, options);
  assert.match(open, /<input data-online-name maxlength="16"[^>]*value="&lt;あ&gt;"/);
  assert.match(open, /<select data-player-deck>/);
  assert.match(open, /<button class="r2-flow-primary" data-online-create>部屋を作る<\/button><button data-flow="open-join">コードで入る<\/button>/);
  const making = onlineEntryHtml({ ...host, online: { available: true, name: '', state: { status: 'creating' } } }, options);
  assert.match(making, /data-online-create aria-disabled="true" data-busy>部屋を作っています…</);
  assert.match(onlineEntryHtml({ ...host, online: { available: true, name: '', state: { status: 'idle', error: { code: 'SERVER_BUSY' } } } }, options), /role="alert">サーバーが混み合っています/);
});

test('joining: the code field and 入る; a wrong code says so', () => {
  const html = onlineJoinHtml({ online: { available: true, code: 'K7M2-QX9D', error: { code: 'ROOM_CODE_INVALID' } } });
  assert.match(html, /<input data-online-code[^>]*value="K7M2-QX9D">/);
  assert.match(html, /<button class="r2-flow-primary" data-online-join>入る<\/button>/);
  assert.match(html, /role="alert">コードが違います/);
  assert.equal(onlineErrorText('ROOM_FULL'), 'この部屋は満員です。');
  assert.equal(onlineErrorText('SOMETHING_NEW'), '通信に失敗しました。');
});

test('the room: its code large while waiting, with copy, share where the browser has it, and the time left', () => {
  const state = { status: 'lobby', display: 'K7M2-QX9D', expiresAt: NOW + 899_001, you: { name: 'あかね', ready: false }, opponent: null, connection: 'open' };
  const waiting = onlineRoomHtml({ online: { state } }, { now: NOW, canShare: false });
  assert.match(waiting, /<div class="r2-online-code" aria-label="部屋コード"><b>K7M2-QX9D<\/b><\/div>/);
  assert.match(waiting, /<button data-online-copy>コピー<\/button><\/div>/);
  assert.match(waiting, /相手を待っています…<span>あと 15:00<\/span>/);
  assert.match(waiting, /<button class="r2-flow-back" data-flow-back>部屋を閉じる<\/button>/);
  assert.match(onlineRoomHtml({ online: { state, copied: true } }, { now: NOW, canShare: true }), /<button data-online-copy>コピーしました<\/button><button data-online-share>共有<\/button>/);
});

test('the room with both: names, the deck and user, who is ready, and 準備完了 or 準備をやめる', () => {
  const state = { status: 'lobby', display: 'K7M2-QX9D', expiresAt: NOW + 59_000, connection: 'open',
    you: { name: 'あかね', ready: false }, opponent: { name: 'みどり', ready: true, connected: true, userId: 'x' } };
  const html = onlineRoomHtml({ online: { state } }, { now: NOW, deckName: '赤', userName: 'Doors ZX', opponentUserName: 'Doors ZX' });
  assert.match(html, /<div class="r2-online-code is-small"/);
  assert.match(html, /<article class="r2-online-seat is-you" data-ready="false"><h2>あかね<small>自分<\/small><\/h2><p>赤 \/ Doors ZX<\/p><span class="r2-online-state">準備中<\/span><\/article>/);
  assert.match(html, /<article class="r2-online-seat is-opponent" data-ready="true"><h2>みどり<small>相手<\/small><\/h2><p>Doors ZX<\/p><span class="r2-online-state">準備完了<\/span><\/article>/);
  assert.match(html, /<button class="r2-flow-primary" data-online-ready>準備完了<\/button>/);
  const ready = onlineRoomHtml({ online: { state: { ...state, you: { ...state.you, ready: true } } } }, { now: NOW });
  assert.match(ready, /<button data-online-unready>準備をやめる<\/button>/);
  assert.match(ready, /相手の準備を待っています…<span>あと 0:59<\/span>/);
  assert.match(onlineRoomHtml({ online: { state: { ...state, connection: 'reconnecting', attempt: 2 } } }, { now: NOW }), /再接続しています…（2回目）/);
});

test('over the board: the opponent and their line, the player\'s own reconnecting, 投了 with its question, then the way out', () => {
  const base = { status: 'playing', match: { matchId: 'm' }, connection: 'open', opponent: { name: 'みどり', connected: true } };
  const hud = state => onlineHudHtml({ online: { state } }, { now: NOW });
  // The match's own parts: the settings window's panel and its buttons (cp-panel), as the other match panels.
  assert.equal(hud(base), '<aside class="r2-online-hud cp-panel" aria-label="オンライン対戦"><span class="r2-online-opponent">相手：<b>みどり</b></span><span class="r2-online-badge">接続中</span><button data-online-concede>投了</button></aside>');
  const away = hud({ ...base, opponent: { name: 'みどり', connected: false }, opponentAwayUntil: NOW + 41_200 });
  assert.ok(away.includes('<span class="r2-online-badge is-away">切断…あと42秒</span>'));
  assert.ok(away.includes('<aside class="r2-online-banner cp-panel" role="status">相手の接続が切れました。あと42秒待ちます</aside>'));
  assert.ok(hud({ ...base, connection: 'reconnecting', attempt: 2, selfAwayUntil: NOW + 51_000 }).includes('<span class="r2-online-self" role="status">再接続しています…（2回目）あと51秒</span>'));
  // The question is the window itself: its backdrop, a panel with the panels' head, its buttons.
  const asking = onlineHudHtml({ online: { state: base, confirming: true } }, { now: NOW });
  assert.ok(asking.includes('<div class="r2-modal" role="alertdialog" aria-modal="true" aria-label="投了の確認"><section class="cp-panel r2-online-confirm"><header class="cp-head"><div><small>MATCH <i>//</i> CONCEDE.SYS</small><h2>投了しますか？</h2></div><button class="cp-close" data-online-concede-no aria-label="やめる">×</button></header>'));
  assert.ok(asking.includes('<button data-online-concede-yes>投了する</button><button data-online-concede-no>やめる</button>'));
  const over = onlineHudHtml({ online: { state: { ...base, status: 'finished' }, confirming: true } }, { now: NOW });
  assert.match(over, /<button data-online-leave>タイトルに戻る<\/button>/);
  assert.doesNotMatch(over, /data-online-concede|alertdialog|接続中/);
  assert.equal(onlineHudHtml({ online: { state: { status: 'idle' } } }, { now: NOW }), '');
  assert.equal(secondsLeft(NOW - 5, NOW), 0);
});

test('an online end screen says why, offers 閉じる and the title, and shows a stopped room that the board never finished', () => {
  assert.equal(onlineResultReason({ result: 'win', reason: 'concede' }), '相手が投了しました');
  assert.equal(onlineResultReason({ result: 'lose', reason: 'concede' }), '投了しました');
  assert.equal(onlineResultReason({ result: 'win', reason: 'disconnect' }), '相手の接続が切れたため勝ち');
  assert.equal(onlineResultReason({ result: 'lose', reason: 'disconnect' }), '接続が切れたため負け');
  assert.equal(onlineResultReason({ result: 'win', reason: 'normal' }), '勝ち');
  assert.equal(onlineResultReason({ result: 'draw', reason: 'normal' }), '引き分け');
  assert.equal(onlineResultReason({ result: 'aborted', reason: 'both-disconnected' }), '両者の接続が切れたため中断');
  assert.equal(onlineResultReason({ result: 'aborted', reason: 'unknown' }), '中断');
  const playing = { finished: false, viewerSeat: 'a', lockedOutcome: null };
  const stopped = runtimeResultHtml(playing, { online: { result: 'aborted', reason: 'storage' } });
  assert.match(stopped, /data-outcome="draw"[^]*NO CONTEST<\/h2><p class="r2-result-reason">サーバーの保存に失敗したため中断<\/p><nav class="r2-result-actions"><button data-runtime-result-close>閉じる<\/button><button data-runtime-title>タイトルに戻る<\/button><\/nav>/);
  assert.equal(runtimeResultHtml(playing, { online: {} }), '', 'nothing before the room or the board says it is over');
  const won = runtimeResultHtml({ finished: true, viewerSeat: 'a', lockedOutcome: { kind: 'win', winnerSeat: 'a' } }, { online: {} });
  assert.match(won, /data-outcome="win"[^]*<\/h2><nav class="r2-result-actions"><button data-runtime-result-close>閉じる/);
  assert.doesNotMatch(won, /data-runtime-save-log|data-runtime-to-menu/);
});
