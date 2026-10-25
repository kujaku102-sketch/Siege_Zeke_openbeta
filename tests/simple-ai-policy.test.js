import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';

const redeploy = cardRef => ({ actionId: `action:${cardRef}`, kind: 'fixed', action: { type: 'redeploy', cardRef, destination: { zone: 'back', slot: 0 } } });
const endTurn = { actionId: 'action:end', kind: 'fixed', action: { type: 'endTurn' } };
const query = ({ matchId, seat = 'cpu', turn, legalActions }) => ({
  status: { matchId, revision: 7, viewerSeat: seat }, observation: { turnNumber: turn },
  requiredInput: null, legalActions
});
const pick = (q, id) => chooseSimpleAiIntent(q, id).value.action;

test('the CPU re-executes the same card at most once per turn and ends the turn instead of looping', () => {
  const legalActions = [redeploy('r:a'), endTurn];
  const mk = turn => query({ matchId: 'ai-limit-1', turn, legalActions });
  assert.equal(pick(mk(5), 'c1').type, 'redeploy');
  assert.equal(pick(mk(5), 'c2').type, 'endTurn', 'a second re-execution of the same card in the same turn is skipped');
  assert.equal(pick(mk(7), 'c3').type, 'redeploy', 'the allowance returns on the next turn');
});

test('the CPU activates the same card effect at most once per turn (cost-neutral effects must not loop)', () => {
  // STD-196 swapped with a memory-recovering card made the CPU activate it for ever (start-purple mirror, seed 31).
  const effect = ref => ({ actionId: `action:eff:${ref}`, kind: 'fixed', actionType: 'activateCardEffect', action: { type: 'activateCardEffect', cardRef: ref, effectKey: 'effect:x', targets: [] } });
  const legalActions = [effect('r:a'), effect('r:b'), endTurn];
  const mk = turn => query({ matchId: 'ai-limit-effect', turn, legalActions });
  assert.equal(pick(mk(9), 'c1').cardRef, 'r:a');
  assert.equal(pick(mk(9), 'c2').cardRef, 'r:b');
  assert.equal(pick(mk(9), 'c3').type, 'endTurn');
  assert.equal(pick(mk(11), 'c4').cardRef, 'r:a', 'the allowance returns on the next turn');
});

test('the CPU re-execution allowance is tracked per card, match and seat', () => {
  const both = [redeploy('r:a'), redeploy('r:b'), endTurn];
  const first = pick(query({ matchId: 'ai-limit-2', turn: 3, legalActions: both }), 'c1');
  assert.deepEqual([first.type, first.cardRef], ['redeploy', 'r:a']);
  const second = pick(query({ matchId: 'ai-limit-2', turn: 3, legalActions: both }), 'c2');
  assert.deepEqual([second.type, second.cardRef], ['redeploy', 'r:b'], 'another card is still allowed');
  assert.equal(pick(query({ matchId: 'ai-limit-2', turn: 3, legalActions: both }), 'c3').type, 'endTurn');
  assert.equal(pick(query({ matchId: 'ai-limit-3', turn: 3, legalActions: both }), 'c4').type, 'redeploy', 'a different match is independent');
  assert.equal(pick(query({ matchId: 'ai-limit-2', seat: 'other', turn: 3, legalActions: both }), 'c5').type, 'redeploy', 'a different seat is independent');
});

const pickInput = options => ({
  choiceId: 'choice:7:selection', kind: 'selection', presentationKey: 'card', actorSeat: 'cpu', canAnswer: true, optional: false,
  constraints: { kind: 'pick', minimum: 1, maximum: 1, aggregate: null, groups: [] }, options: options.map(optionId => ({ optionId }))
});
const answerQuery = (matchId, revision, options = ['o1', 'o2', 'o3']) => ({
  status: { matchId, revision, viewerSeat: 'cpu' }, observation: { turnNumber: 4 }, legalActions: [], requiredInput: pickInput(options)
});
const answered = q => chooseSimpleAiIntent(q, 'c').value.action.optionIds[0];

test('the CPU tries a different option when the same required input comes back at the same revision', () => {
  // A rejected answer leaves the revision unchanged; repeating it would never advance the match.
  assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o1');
  assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o2');
  assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o3');
  assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o1', 'wraps around after every option was tried');
  assert.equal(answered(answerQuery('ai-answer-1', 13)), 'o1', 'a new revision starts again from the first option');
  assert.equal(answered(answerQuery('ai-answer-2', 13)), 'o1', 'another match is independent');
});

test('the CPU keeps its opening hand when keeping is legal and still mulligans in the legacy opening', () => {
  const mulligan = { actionId: 'action:mull', kind: 'fixed', action: { type: 'openingMulligan' } };
  const keep = { actionId: 'action:keep', kind: 'fixed', action: { type: 'keepOpeningHand' } };
  assert.equal(pick(query({ matchId: 'ai-open-1', turn: 1, legalActions: [mulligan, keep] }), 'c1').type, 'keepOpeningHand');
  assert.equal(pick(query({ matchId: 'ai-open-2', turn: 1, legalActions: [mulligan, endTurn] }), 'c2').type, 'openingMulligan');
});

test('the CPU reports no legal action instead of repeating a spent re-execution', () => {
  const q = query({ matchId: 'ai-limit-4', turn: 2, legalActions: [redeploy('r:a')] });
  assert.equal(chooseSimpleAiIntent(q, 'c1').ok, true);
  const exhausted = chooseSimpleAiIntent(q, 'c2');
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.error.code, 'AI_NO_LEGAL_ACTION');
});
