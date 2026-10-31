import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { recommendDeck, deckToRecipe } from '../src/game/deck-builder.js';

for (const answer of ['decline', 'empty-selection']) {
  test(`Security -> Savage choice -> turn handoff accepts ${answer} without reopening Security`, () => {
    const recipe = (userId, color) => deckToRecipe({ userId, cards: recommendDeck({ userId, color }).cards });
    const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
      matchId: `security-salvage-${answer}`, seatIds: ['self', 'enemy'], seed: 12,
      ruleVersion: '2.0', cardVersion: 'public', gameOptions: { mode: 'ai',
        playerUserId: 'doors_nt', aiUserId: 'savage_salvage',
        playerDeckRecipe: recipe('doors_nt', '赤'), aiDeckRecipe: recipe('savage_salvage', '黄') }
    } });
    assert.equal(made.ok, true);
    const session = made.value;
    let securityRevision = null, salvageSeen = false, completed = false;
    try {
      // Ordinary setup and legal commands only; no engine-state fixtures.
      for (let step = 0; step < 24; step++) {
        let port = session.port('self').value, query = port.query().value;
        if (query.requiredInput ? !query.requiredInput.canAnswer : query.status.activeSeat !== 'self') {
          port = session.port('enemy').value; query = port.query().value;
        }
        if (securityRevision !== null && query.status.activeSeat === 'self') {
          assert.equal(query.observation.turnNumber, 3);
          completed = true; break;
        }
        const intent = chooseSimpleAiIntent(query, `step:${step}`, input => port.queryAction(input));
        assert.equal(intent.ok, true, JSON.stringify(intent));
        if (query.requiredInput?.presentationKey === 'security-rest') {
          assert.equal(securityRevision, null, 'Security must not reopen after salvage');
          securityRevision = query.status.revision;
          // The CPU rests one Security on its own, so each path is spelled out here.
          intent.value.action = answer === 'empty-selection' ? { type: 'answerChoice',
            choiceId: query.requiredInput.choiceId, optionIds: [], allocation: [] }
            : { type: 'declineChoice', choiceId: query.requiredInput.choiceId };
        } else if (securityRevision !== null && query.requiredInput?.canAnswer) {
          salvageSeen = true;
        }
        const result = port.submit(intent.value);
        assert.equal(result.ok, true, JSON.stringify(result.error));
        assert.equal(result.value.receipt.status, 'accepted', JSON.stringify(result.value.receipt));
        if (query.status.revision === securityRevision) {
          const next = port.query().value;
          assert.equal(next.requiredInput?.canAnswer, true, 'Later end-of-turn choice is retained');
          assert.notEqual(next.requiredInput?.presentationKey, 'security-rest');
          assert.equal(next.status.revision, securityRevision + 1);
        }
      }
      assert.equal(salvageSeen, true);
      assert.equal(completed, true);
    } finally { session.dispose(); }
  });
}
