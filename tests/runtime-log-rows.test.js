import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL('../src/ui-refresh/runtime-log-rows.js', import.meta.url));
const rows = await import('../src/ui-refresh/runtime-log-rows.js');
const view = await import('../src/ui-refresh/runtime-log-view.js');

test('the log rows module loads with nothing behind it: no imports, no DOM, no import.meta', () => {
  const source = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(|import\.meta|\bdocument\b|\bwindow\b|\blocalStorage\b/m);
  for (const name of ['runtimeLogRows', 'logEntry', 'runtimeEventText']) assert.equal(typeof rows[name], 'function', name);
});

test('the log window and the match log share the one runtimeLogRows', () => {
  assert.equal(view.runtimeLogRows, rows.runtimeLogRows);
});

test('plain rows: who, the tag, the card, a sentence and the numbers; an answer is not a row', () => {
  const swordsman = { kind: 'card', cardRef: 'r1', faceDown: false, definitionId: 'X-1', name: '剣士' };
  const events = [
    { eventId: 'e1', commandId: 'c1', type: 'action_committed', actionType: 'install', turnNumber: 3, actorSeat: 'seat-a', source: swordsman },
    { eventId: 'e2', commandId: 'c1', type: 'card_moved', turnNumber: 3, actorSeat: 'seat-a', target: swordsman,
      from: { kind: 'board', seatId: 'seat-a', zone: 'hand' }, to: { kind: 'board', seatId: 'seat-a', zone: 'registry' } },
    { eventId: 'e3', commandId: 'c2', type: 'user_damaged', turnNumber: 4, actorSeat: 'seat-b', source: { kind: 'card', faceDown: true },
      target: { kind: 'user', seatId: 'seat-a' }, amount: 4, before: 20, after: 16 },
    { eventId: 'e4', commandId: 'c3', type: 'action_committed', actionType: 'answerChoice', turnNumber: 4, actorSeat: 'seat-b' },
    { eventId: 'e5', commandId: 'c4', type: 'turn_started', turnNumber: 5, actorSeat: 'seat-a' }
  ];
  assert.deepEqual(rows.runtimeLogRows(events, 'seat-a'), [
    { turn: 3, side: 'you', tag: 'INSTALL', card: '剣士', text: 'インストール' },
    { turn: 3, side: 'you', tag: 'MOVE', card: '剣士', text: '手札から「剣士」をインストール。' },
    { turn: 4, side: 'opponent', tag: 'DAMAGE', card: '裏向きカード', text: '→ 自分のユーザー', numbers: ['4 DMG', 'STR 20→16'] },
    { turn: 5, side: 'system', tag: 'TURN', text: 'ターン開始' }
  ]);
  // The other seat reads the same match from its side.
  assert.equal(rows.runtimeLogRows(events, 'seat-b')[2].text, '→ 相手ユーザー');
});
