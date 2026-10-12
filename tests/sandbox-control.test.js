import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';

function session(mode = 'sandbox') {
  const created = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'sandbox-controls', seatIds: ['a', 'b'], seed: 23, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: { mode, sandboxDeckSetup: mode === 'sandbox' }
  } });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
}
test('ordinary ports cannot acquire or forge the sandbox capability', () => {
  const game = session();
  const port = game.port('a').value;
  const intent = { commandId: 'normal-add', expectedRevision: 0,
    action: { type: 'sandboxAddCard', definitionId: 'STD-075', targetSeat: 'b' } };
  assert.equal(port.submit(intent).error.code, 'CAPABILITY_REQUIRED');
  assert.equal(port.query().value.status.revision, 0);
  assert.equal(Object.hasOwn(port, 'sandboxControl'), false);
  const control = game.sandboxControl('a').value;
  const added = control.submit({ ...intent, commandId: 'trusted-add' });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.value.kind, 'accepted');
  assert.equal(port.query().value.status.revision, 1);
  assert.equal(session('ai').sandboxControl('a').error.code, 'CAPABILITY_REQUIRED');
});
test('active seat control commits a journaled revision, exact retry stays once and disposal revokes handle', () => {
  const game = session();
  const control = game.sandboxControl('a').value;
  const port = game.port('a').value;
  const intent = { commandId: 'switch', expectedRevision: 0,
    action: { type: 'sandboxSelectActiveSeat', targetSeat: 'b' } };
  const accepted = control.submit(intent);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.value.kind, 'accepted');
  assert.equal(port.query().value.status.activeSeat, 'b');
  assert.equal(port.query().value.status.revision, 1);
  assert.deepEqual(control.submit(intent), accepted);
  assert.equal(port.receipt('switch').value.status, 'accepted');
  assert.equal(port.submit({ ...intent, commandId: 'ordinary-switch', expectedRevision: 1 }).error.code, 'CAPABILITY_REQUIRED');
  game.dispose();
  assert.equal(control.submit(intent).error.code, 'MATCH_SESSION_DISPOSED');
});
