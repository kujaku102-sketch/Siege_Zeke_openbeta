import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { createTutorialModeController, tutorialStateData, TUTORIAL_STEP_GUARDS } from '../src/adapters/tutorial-mode-controller.js';

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
  for (let count = 0; count < 2; count += 1) game.advanceTutorial();
  const played = submit(player, { type: 'executeCard', cardRef: hand('STD-091').cardRef,
    destination: { zone: 'front', slot: 2 } }, 'play');
  assert.equal(played.value.kind, 'accepted');
  for (let count = 0; count < 7; count += 1) game.advanceTutorial();
  assert.equal(game.tutorial().value.flow.index, 29);
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
  assert.equal(game.tutorial().value.flow.index, 30);
});
test('red step 37: the Junk Parts anywhere but under Atto is refused with the guard reason, alone in the back too', () => {
  const controller = createTutorialModeController('basics');
  const card = (id, zone) => ({ cardRef: `r-${id}`, definition: { id }, faceDown: false, mounted: [], location: { zone } });
  const seat = (seatId, cards) => ({ seatId, hand: { cards: cards.filter(item => item.location.zone === 'hand') },
    ...Object.fromEntries(['front', 'back', 'registry', 'trash', 'ban'].map(zone => [zone, { cards: cards.filter(item => item.location.zone === zone) }])) });
  const query = { observation: { seats: [seat('a', [card('STD-021', 'front'), card('STD-091', 'front'), card('STD-087', 'hand'), card('STD-078', 'hand')]),
    seat('b', [card('STD-022', 'front')])] }, status: { viewerSeat: 'a', activeSeat: 'a', lockedOutcome: null, progress: 'awaitingAction' }, requiredInput: null };
  const moves = {
    play: expect => ({ type: 'executeCard', cardRef: `r-${expect.cardId}`, destination: { zone: expect.zone } }),
    install: expect => ({ type: 'install', cardRef: `r-${expect.cardId}` }),
    attack: expect => ({ type: 'attack', attackerRef: `r-${expect.cardId}`, target: expect.targetCardId ? { kind: 'card', cardRef: `r-${expect.targetCardId}` } : { kind: 'user', seatId: 'b' } }),
    'end-turn': () => ({ type: 'endTurn' })
  };
  while (controller.presentation().flow.index < 37 || !controller.presentation().flow.introComplete) {
    const expect = controller.presentation().presentation.expect;
    if (!controller.presentation().flow.introComplete || expect.type === 'advance') { assert.equal(controller.advance().ok, true); continue; }
    const action = moves[expect.type](expect);
    assert.equal(controller.authorize(query, action).ok, true, JSON.stringify(expect));
    controller.accepted(query, action);
  }
  const reason = TUTORIAL_STEP_GUARDS.basics[37].reason;
  for (const action of [{ type: 'executeCard', cardRef: 'r-STD-078', destination: { zone: 'back' } },
    { type: 'mountCard', cardRef: 'r-STD-078', hostRef: 'r-STD-021' },
    { type: 'executeCard', cardRef: 'r-STD-078', destination: { zone: 'front' } }]) {
    assert.equal(controller.authorize(query, action).error?.code, 'TUTORIAL_ACTION_NOT_EXPECTED', JSON.stringify(action));
    assert.equal(controller.presentation().flow.error, reason, JSON.stringify(action));
  }
  assert.equal(controller.authorize(query, { type: 'mountCard', cardRef: 'r-STD-078', hostRef: 'r-STD-091' }).ok, true);
});

test('the guide state goes out as five items and comes back into a new controller', () => {
  const fresh = createTutorialModeController('blue');
  const out = fresh.state();
  assert.deepEqual(Object.keys(out).sort(), ['flow', 'opponentActionPending', 'opponentIndex', 'opponentScript', 'stepActionAccepted']);
  assert.equal(out.stepActionAccepted, false);
  assert.equal(tutorialStateData('blue', out) !== null, true);
  const mid = { ...out, flow: { ...out.flow, index: 10 }, opponentScript: 'sandbag-1', opponentIndex: 1, stepActionAccepted: true, opponentActionPending: true };
  const restored = createTutorialModeController('blue', mid);
  assert.deepEqual(restored.state(), mid);
  assert.equal(restored.presentation().flow.index, 10);
  assert.equal(restored.presentation().opponentScript, 'sandbag-1');
  assert.throws(() => createTutorialModeController('blue', { ...mid, opponentIndex: 5 }), /TUTORIAL_STATE_INVALID/);
});

test('guide state data refuses what does not fit the tutorial', () => {
  const good = createTutorialModeController('basics').state();
  assert.notEqual(tutorialStateData('basics', good), null);
  const bad = change => tutorialStateData('basics', structuredClone(change(structuredClone(good))));
  assert.equal(tutorialStateData('blue', good), null, 'another tutorial');
  assert.equal(tutorialStateData('nowhere', good), null);
  assert.equal(bad(state => { state.extra = 1; return state; }), null);
  assert.equal(bad(state => { state.flow.index = 999; return state; }), null);
  assert.equal(bad(state => { state.flow.introIndex = 99; return state; }), null);
  assert.equal(bad(state => { state.flow.error = 'x'; return state; }), null);
  assert.equal(bad(state => { state.flow.complete = true; return state; }), null);
  assert.equal(bad(state => { state.opponentScript = 'nowhere'; return state; }), null);
  assert.equal(bad(state => { state.opponentScript = 'yellow-pass'; state.opponentIndex = 5; return state; }), null);
  assert.equal(bad(state => { state.stepActionAccepted = 1; return state; }), null);
  assert.equal(tutorialStateData('basics', null), null);
});
