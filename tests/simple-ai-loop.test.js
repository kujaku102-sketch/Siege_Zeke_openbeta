import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSimpleAiIntent, simpleAiLoopStats } from '../src/adapters/simple-ai-policy.js';

// 結果の変わらない同じ処理を繰り返さない(ゲームの CPU の禁止事項。2026-11-09、文豪「CPU操作の禁止事項でいい」)。人の操作は制限しない。
let serial = 0;
const picker = { kind: 'pick', minimum: 1, maximum: 1, aggregate: null, groups: [], assignment: 'free' };
const window = (over = {}) => ({
  canAnswer: true, choiceId: 'choice-1', optional: false, purpose: 'selection', presentationKey: 'selection',
  options: [{ optionId: 'o1' }, { optionId: 'o2' }, { optionId: 'o3' }], constraints: picker, ...over
});
// the window comes back on the same board each time the answer was accepted (the revision moves on)
function runner(input, { matchId = `loop-${(serial += 1)}`, board = () => 'same', turn = () => 3 } = {}) {
  let revision = 10;
  const answer = () => {
    revision += 1;
    const query = { status: { matchId, viewerSeat: 'seat-a', revision }, observation: { turnNumber: turn(revision), board: board(revision), revision }, legalActions: [], requiredInput: input };
    const result = chooseSimpleAiIntent(query, `command-${revision}`);
    assert.equal(result.ok, true);
    const { action } = result.value;
    return action.type === 'declineChoice' ? 'decline' : action.optionIds.join(',');
  };
  return { answer, matchId };
}

test('a window answered the same way on the same board twice takes another option the third time', () => {
  const { answer, matchId } = runner(window());
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(answer), ['o1', 'o1', 'o2', 'o2', 'o3', 'o3']);
  assert.equal(simpleAiLoopStats(matchId, 'seat-a').unavoidable, 0);
  // every answer has been given twice: there is no other answer, the usual one goes on (an unanswered window stops the match) and the CPU counts it
  assert.equal(answer(), 'o1');
  assert.equal(simpleAiLoopStats(matchId, 'seat-a').unavoidable, 1);
});

test('an optional window is declined as always, and answered from the sixth time on the same board', () => {
  const { answer } = runner(window({ optional: true }));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(answer), ['decline', 'decline', 'decline', 'decline', 'decline', 'o1', 'o1', 'decline']);
});

test('a board that changes between the answers is not a repeat', () => {
  const { answer } = runner(window(), { board: (revision) => `board-${revision}` });
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(answer), ['o1', 'o1', 'o1', 'o1', 'o1', 'o1']);
});

test('a new turn counts again from the start', () => {
  const { answer } = runner(window(), { turn: (revision) => (revision > 12 ? 4 : 3) });
  // two answers in turn 3, then turn 4 starts the count again: o1 twice more before the other option
  assert.deepEqual([1, 2, 3, 4, 5].map(answer), ['o1', 'o1', 'o1', 'o1', 'o2']);
});

test('a rejected answer (the revision does not move) is not counted; the existing rotation of the options goes on', () => {
  const matchId = `loop-${(serial += 1)}`;
  const query = { status: { matchId, viewerSeat: 'seat-a', revision: 5 }, observation: { turnNumber: 3, board: 'same', revision: 5 }, legalActions: [], requiredInput: window() };
  const given = [1, 2, 3, 4].map((n) => chooseSimpleAiIntent(query, `rejected-${n}`).value.action.optionIds[0]);
  assert.deepEqual(given, ['o1', 'o2', 'o3', 'o1']);
});
