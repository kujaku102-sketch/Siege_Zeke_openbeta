import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { createMatchUiController } from '../src/adapters/match-ui-controller.js';
import { runtimeGameHtml } from '../src/ui-refresh/runtime-read-view.js';

function setup() {
  const session = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'gui-test', seatIds: ['a', 'b'], seed: 11, ruleVersion: '2.0', cardVersion: 'public',
    gameOptions: { mode: 'ai', playerDeckRecipe: [['STD-020', 40]], aiDeckRecipe: [['STD-020', 40]] }
  } });
  assert.equal(session.ok, true, JSON.stringify(session));
  const ui = createMatchUiController({ session: session.value, viewerSeat: 'a' });
  assert.equal(ui.ok, true);
  return { session: session.value, ui: ui.value, port: session.value.port('a').value };
}
test('GUI execution drafts do not mutate; confirmed command commits once', () => {
  const { ui, port } = setup();
  const start = ui.read().value;
  const execute = start.model.legalActions.find(entry => entry.actionType === 'executeCard');
  assert.ok(execute);
  const plan = ui.chooseAction(execute.actionId).value;
  assert.ok(plan.request);
  assert.equal(port.query().value.status.revision, 0);
  const chosen = ui.toggleOption(plan.request.options[0].optionId);
  assert.equal(chosen.ok, true, JSON.stringify(chosen));
  assert.equal(port.query().value.status.revision, 0);
  const ready = ui.confirm();
  assert.ok(ready.value.plan.completion);
  assert.equal(port.query().value.status.revision, 0);
  const committed = ui.confirm();
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(committed.value.model.match.revision, 1);
  assert.equal(ui.confirm().ok, false);
  assert.equal(port.query().value.status.revision, 1);
});
test('precommit back and collapse preserve match; stale plans are discarded', () => {
  const { session, ui, port } = setup();
  const entry = ui.read().value.model.legalActions.find(entry => entry.actionType === 'executeCard');
  ui.chooseAction(entry.actionId);
  assert.equal(ui.toggleCollapsed().value.collapsed, true);
  assert.equal(ui.back().value.plan, null);
  assert.equal(port.query().value.status.revision, 0);
  ui.chooseAction(entry.actionId);
  port.submit({ commandId: 'external', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(ui.read().value.plan, null);
  session.dispose();
  assert.equal(ui.read().ok, false);
});
test('rendered execution selection uses cards, current board structure and result only after finish', () => {
  const { ui } = setup();
  const read = ui.read().value;
  const entry = read.model.legalActions.find(entry => entry.actionType === 'executeCard');
  const planned = ui.chooseAction(entry.actionId).value;
  const html = runtimeGameHtml(planned.model, planned);
  assert.match(html, /zone-cards/);
  assert.match(html, /admin-row/);
  assert.match(html, /data-runtime-confirm/);
  assert.doesNotMatch(html, /data-runtime-rematch/);
  const finished = { ...read.model, match: { ...read.model.match, finished: true,
    lockedOutcome: { kind: 'win', winnerSeat: 'a' } } };
  assert.match(runtimeGameHtml(finished), /VICTORY/);
  assert.match(runtimeGameHtml(finished), /data-runtime-rematch/);
  assert.equal(ui.toggleMenu().value.model.ui.menuOpen, true);
  assert.equal(ui.toggleMenu().value.model.ui.menuOpen, false);
});
test('menu/log/back/collapse cannot consume a mandatory choice; confirm answers it through its port', () => {
  const session = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'gui-required', seatIds: ['a', 'b'], seed: 11, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: { mode: 'sandbox' }
  } }).value;
  const port = session.port('a').value;
  session.sandboxControl().value.submit({ commandId: 'add', expectedRevision: 0,
    action: { type: 'sandboxAddCard', definitionId: 'STD-224', targetSeat: 'a' } });
  const card = port.query().value.observation.seats[0].hand.cards[0];
  port.submit({ commandId: 'install', expectedRevision: 1, action: { type: 'install', cardRef: card.cardRef } });
  const ui = createMatchUiController({ session, viewerSeat: 'a' }).value;
  const first = ui.read().value;
  const choice = first.request.requestId;
  assert.equal(first.model.requiredInput.optional, false);
  for (const operation of [ui.toggleMenu, ui.toggleLog, ui.toggleCollapsed, ui.back, ui.toggleHand]) {
    const read = operation();
    assert.equal(read.value.request.requestId, choice);
    assert.equal(read.value.model.match.revision, 2);
  }
  assert.equal(ui.decline().ok, false);
  ui.toggleOption(first.request.options[0].optionId);
  const confirmed = ui.confirm();
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.equal(confirmed.value.request, null);
  assert.equal(confirmed.value.model.match.revision, 3);
});
