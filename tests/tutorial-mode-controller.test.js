import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';

function setup() {
  const created = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'tutorial-policy', seatIds: ['a', 'b'], seed: 71, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: { mode: 'tutorial' }
  } });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
}
function submit(port, action, commandId) {
  return port.submit({ commandId, expectedRevision: port.query().value.status.revision, action });
}
test('tutorial rejects before engine, intro only affects policy, accepted retry does not advance twice', () => {
  const game = setup();
  const port = game.port('a').value;
  const earlyCard = port.query().value.observation.seats[0].hand.cards.find(card => card.definition.id === 'STD-087');
  const early = submit(port, { type: 'install', cardRef: earlyCard.cardRef }, 'early-install');
  assert.equal(early.error.code, 'TUTORIAL_ACTION_NOT_EXPECTED');
  assert.equal(submit(port, { type: 'endTurn' }, 'unexpected').error.code, 'TUTORIAL_ACTION_NOT_EXPECTED');
  assert.equal(port.query().value.status.revision, 0);
  // 7 introduction lines, then the script's first 11 speech bubbles (one bubble per step).
  for (let count = 0; count < 18; count += 1) assert.equal(game.advanceTutorial().ok, true);
  assert.equal(game.tutorial().value.flow.index, 11);
  assert.equal(port.query().value.status.revision, 0);
  // Step 11 asks for the swordsman in the front; installing Glenn now is not what the guide wants.
  assert.equal(submit(port, { type: 'install', cardRef: earlyCard.cardRef }, 'too-early-install').error.code, 'TUTORIAL_ACTION_NOT_EXPECTED');
  const query = port.query().value;
  const card = query.observation.seats[0].hand.cards.find(card => card.definition.id === 'STD-021');
  assert.ok(card);
  const intent = { commandId: 'soldier', expectedRevision: 0, action: { type: 'executeCard', cardRef: card.cardRef, destination: { zone: 'front', slot: 1 } } };
  const accepted = port.submit(intent);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.value.kind, 'accepted');
  assert.equal(game.tutorial().value.flow.index, 12);
  assert.deepEqual(port.submit(intent), accepted);
  assert.equal(game.tutorial().value.flow.index, 12);
  game.dispose();
  assert.equal(game.advanceTutorial().ok, false);
});
test('tutorial normal play and attack use ports; opponent cannot act before scripted turn', () => {
  const game = setup();
  const player = game.port('a').value, opponent = game.port('b').value;
  assert.equal(submit(opponent, { type: 'endTurn' }, 'early-ai').error.code, 'TUTORIAL_ACTION_NOT_EXPECTED');
  for (let count = 0; count < 18; count += 1) game.advanceTutorial();
  const hand = id => player.query().value.observation.seats[0].hand.cards.find(card => card.definition.id === id);
  const soldier = submit(player, { type: 'executeCard', cardRef: hand('STD-021').cardRef, destination: { zone: 'front', slot: 1 } }, 'soldier');
  assert.equal(soldier.value.kind, 'accepted');
  for (let count = 0; count < 6; count += 1) game.advanceTutorial();
  assert.equal(game.tutorial().value.flow.index, 18);
  submit(player, { type: 'install', cardRef: hand('STD-087').cardRef }, 'install');
  for (let count = 0; count < 3; count += 1) game.advanceTutorial();
  const played = submit(player, { type: 'executeCard', cardRef: hand('STD-091').cardRef,
    destination: { zone: 'front', slot: 2 } }, 'play');
  assert.equal(played.value.kind, 'accepted');
  for (let count = 0; count < 8; count += 1) game.advanceTutorial();
  assert.equal(game.tutorial().value.flow.index, 31);
  let query = player.query().value;
  const attacker = query.observation.seats[0].front.cards.find(card => card.definition.id === 'STD-091');
  const attacked = submit(player, { type: 'attack', attackerRef: attacker.cardRef,
    target: { kind: 'user', seatId: 'b' } }, 'attack');
  assert.equal(attacked.ok, true, JSON.stringify(attacked));
  // Resolve all rule-owned input through the answering port, never clearing it.
  for (let count = 0; count < 10; count += 1) {
    const query = player.query().value;
    if (!query.requiredInput) break;
    const answering = query.requiredInput.actorSeat === 'a' ? player : opponent;
    const intent = chooseSimpleAiIntent(answering.query().value, `answer-${count}`, input => answering.queryAction(input));
    assert.equal(intent.ok, true, JSON.stringify(intent));
    assert.equal(answering.submit(intent.value).ok, true);
  }
  assert.equal(game.tutorial().value.flow.index, 32);
});
