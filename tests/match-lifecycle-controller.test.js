import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchLifecycleController } from '../src/adapters/match-lifecycle-controller.js';

const config = mode => ({ matchId: 'lifecycle-first', seatIds: ['a', 'b'], seed: 71,
  ruleVersion: 'rules', cardVersion: 'cards', gameOptions: { mode } });
test('rematch revokes old ports and registered timers; invalid setup keeps current match', () => {
  const lifecycle = createMatchLifecycleController({ nextMatchId: () => 'lifecycle-second' });
  const first = lifecycle.start(config('ai'));
  assert.equal(first.ok, true, JSON.stringify(first));
  const old = first.value.port('a').value;
  let cleaned = 0;
  first.value.track({ dispose() { cleaned += 1; } });
  assert.equal(lifecycle.start({ ...config('ai'), seed: null }).ok, false);
  assert.equal(old.query().ok, true);
  const next = lifecycle.rematch();
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(cleaned, 1);
  assert.equal(old.query().ok, false);
  assert.equal(next.value.scope().sessionGeneration, 2);
  assert.equal(next.value.port('a').value.query().value.status.revision, 0);
  lifecycle.dispose();
  assert.equal(next.value.port('a').ok, false);
});
test('tutorial abandonment creates a fresh sandbox without carrying intro state', () => {
  const lifecycle = createMatchLifecycleController({ nextMatchId: () => 'sandbox-replacement' });
  const first = lifecycle.start(config('tutorial')).value;
  const port = first.port('a').value;
  const next = lifecycle.skipTutorial();
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(port.submit({ commandId: 'late', expectedRevision: 0, action: { type: 'endTurn' } }).ok, false);
  assert.equal(next.value.sandboxControl().ok, true);
  assert.equal(next.value.port('a').value.query().value.status.revision, 0);
  assert.deepEqual(next.value.takeEvents().value, []);
});
test('rematch can abandon a real mandatory plugin choice without answering or deleting it', () => {
  const lifecycle = createMatchLifecycleController({ nextMatchId: () => 'sandbox-rematch' });
  const first = lifecycle.start(config('sandbox')).value;
  const port = first.port('a').value;
  const added = first.sandboxControl('a').value.submit({ commandId: 'add', expectedRevision: 0,
    action: { type: 'sandboxAddCard', definitionId: 'STD-224', targetSeat: 'a' } });
  assert.equal(added.value.kind, 'accepted');
  const card = port.query().value.observation.seats[0].hand.cards.find(card => card.definition.id === 'STD-224');
  const installed = port.submit({ commandId: 'install', expectedRevision: 1,
    action: { type: 'install', cardRef: card.cardRef } });
  assert.equal(installed.value.kind, 'accepted');
  assert.equal(port.query().value.requiredInput.optional, false);
  const replacement = lifecycle.rematch();
  assert.equal(replacement.ok, true, JSON.stringify(replacement));
  assert.equal(port.query().ok, false);
  assert.equal(replacement.value.port('a').value.query().value.requiredInput, null);
  assert.equal(replacement.value.port('a').value.query().value.status.revision, 0);
});
