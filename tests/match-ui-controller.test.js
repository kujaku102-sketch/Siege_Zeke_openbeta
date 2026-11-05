import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { createMatchUiController, flow, when, isThenable } from '../src/adapters/match-ui-controller.js';
import { runtimeGameHtml } from '../src/ui-refresh/runtime-read-view.js';
import { buildInteractionRequest, resolveInteractionTarget } from '../src/adapters/interaction-targets.js';

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
  assert.match(html, /board-pick-guide/);
  assert.doesNotMatch(html, /data-runtime-confirm/);
  assert.doesNotMatch(html, /class="r2-result /);
  const finished = { ...read.model, match: { ...read.model.match, finished: true,
    lockedOutcome: { kind: 'win', winnerSeat: 'a' } } };
  assert.match(runtimeGameHtml(finished), /CONGRATULATION!/);
  assert.match(runtimeGameHtml(finished), /data-runtime-save-log/);
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

function countedSession(real, hooks = {}) {
  const counts = { query: 0, queryAction: 0, submit: 0 };
  const ports = new Map();
  return { counts, session: {
    readStamp(seatId) { return hooks.readStamp?.(seatId) ?? real.readStamp(seatId); },
    port(seatId) {
      if (ports.has(seatId)) return { ok: true, value: ports.get(seatId) };
      const bound = real.port(seatId);
      if (!bound.ok) return bound;
      const source = bound.value;
      const port = {
        query(input) { counts.query += 1; return source.query(input); },
        latest() { return source.latest(); },
        queryAction(input) { counts.queryAction += 1; return hooks.queryAction?.(input, source) ?? source.queryAction(input); },
        submit(input) { counts.submit += 1; const result = source.submit(input); hooks.afterSubmit?.(result); return result; },
        receipt(id) { return source.receipt(id); },
        events(input) { return source.events(input); },
        dispose() { return { ok: true, value: null }; }
      };
      ports.set(seatId, port);
      return { ok: true, value: port };
    }
  } };
}

test('redesign: local UI changes reuse one projection and do not requery or replan', () => {
  const base = setup();
  const wrapped = countedSession(base.session);
  const ui = createMatchUiController({ session: wrapped.session, viewerSeat: 'a' }).value;
  const first = ui.read().value;
  const initialQueries = wrapped.counts.query;
  assert.equal(initialQueries, 1);
  ui.toggleMenu(); ui.toggleMenu(); ui.toggleLog(); ui.toggleLog(); ui.toggleHand(); ui.toggleHand();
  assert.equal(wrapped.counts.query, initialQueries);
  assert.equal(wrapped.counts.queryAction, 0);
  const execute = first.model.legalActions.find(entry => entry.actionType === 'executeCard');
  const draft = ui.chooseAction(execute.actionId).value;
  assert.equal(wrapped.counts.queryAction, 1);
  ui.toggleOption(draft.request.options[0].optionId);
  assert.equal(wrapped.counts.queryAction, 1);
});

test('redesign: failed staged replan leaves answer and history untouched', () => {
  const base = setup();
  let calls = 0;
  const wrapped = countedSession(base.session, { queryAction(input, source) {
    calls += 1;
    return calls === 2 ? { ok: false, error: { code: 'PLANNED_FAILURE' } } : source.queryAction(input);
  } });
  const ui = createMatchUiController({ session: wrapped.session, viewerSeat: 'a' }).value;
  const execute = ui.read().value.model.legalActions.find(entry => entry.actionType === 'executeCard');
  const planned = ui.chooseAction(execute.actionId).value;
  const optionId = planned.request.options[0].optionId;
  ui.toggleOption(optionId);
  assert.deepEqual(ui.confirm(), { ok: false, error: { code: 'PLANNED_FAILURE' } });
  const retained = ui.read().value;
  assert.equal(retained.request.requestId, planned.request.requestId);
  assert.deepEqual(retained.selection.optionIds, [optionId]);
  assert.deepEqual(retained.preview.history, []);
});

test('redesign: completed destination remains typed in preview after the plan advances', () => {
  const { ui } = setup();
  const execute = ui.read().value.model.legalActions.find(entry => entry.actionType === 'executeCard');
  const planned = ui.chooseAction(execute.actionId).value;
  const destination = planned.request.options.find(option => option.zone === 'front' && option.slot === 2);
  assert.ok(destination);
  ui.toggleOption(destination.optionId);
  const ready = ui.confirm().value;
  assert.ok(ready.plan.completion);
  assert.deepEqual(ready.preview.destination, destination);
  assert.deepEqual(ready.preview.target, []);
  assert.equal(ready.preview.history[0].presentationKey, 'execution-destination');
  assert.deepEqual(ready.preview.history[0].targets,
    [{ kind: 'slot', seatId: 'a', zone: 'front', slot: 2 }]);
});

test('redesign: accepted command plus read failure never resubmits', () => {
  const base = setup();
  let failRead = false;
  const wrapped = countedSession(base.session, {
    readStamp(seatId) { return failRead ? { ok: false, error: { code: 'READ_FAULT' } } : base.session.readStamp(seatId); },
    afterSubmit(result) { if (result.ok) failRead = true; }
  });
  const ui = createMatchUiController({ session: wrapped.session, viewerSeat: 'a' }).value;
  const endTurn = ui.read().value.model.legalActions.find(entry => entry.action?.type === 'endTurn');
  const result = ui.chooseAction(endTurn.actionId);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MATCH_UI_READ_AFTER_ACCEPT_FAILED');
  assert.equal(wrapped.counts.submit, 1);
  failRead = false;
  assert.equal(ui.read().value.model.match.revision, 1);
  assert.equal(wrapped.counts.submit, 1);
});

test('redesign: event acknowledgement removes only the exact rendered prefix', () => {
  const { session, ui } = setup();
  const first = ui.read().value;
  const endTurn = first.model.legalActions.find(entry => entry.action?.type === 'endTurn');
  const afterFirst = ui.chooseAction(endTurn.actionId).value;
  const firstBatch = afterFirst.events.map(event => event.eventId);
  assert.ok(firstBatch.length > 0);
  const other = session.port('b').value;
  const otherRead = other.query().value;
  const otherEnd = otherRead.legalActions.find(entry => entry.action?.type === 'endTurn');
  const submitted = other.submit({ commandId: 'event-prefix-next', expectedRevision: otherRead.status.revision,
    action: otherEnd.action });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  const withNewEvents = ui.read().value.events.map(event => event.eventId);
  assert.ok(withNewEvents.length > firstBatch.length);
  assert.deepEqual(ui.ackEvents(firstBatch), { ok: true, value: null });
  assert.deepEqual(ui.read().value.events.map(event => event.eventId), withNewEvents.slice(firstBatch.length));
  assert.deepEqual(ui.ackEvents(firstBatch.slice(1)), { ok: false, error: { code: 'INVALID_EVENT_ACK' } });
});

test('redesign: public board positions are exact and ambiguous hits never pick the first option', () => {
  const faceDown = 'r:11111111111111111111111111111111';
  const faceUp = 'r:22222222222222222222222222222222';
  const mismatch = 'r:33333333333333333333333333333333';
  const model = { match: { viewerSeat: 'a' }, seats: [{ seatId: 'a', user: { frontLimit: 5, backLimit: 5 },
    front: { cards: [{ cardRef: faceDown, faceDown: true, area: 'front', slot: 2 },
      { cardRef: faceUp, faceDown: false, location: { kind: 'board', seatId: 'a', zone: 'front', position: 3 } },
      { cardRef: mismatch, faceDown: false, location: { kind: 'board', seatId: 'b', zone: 'front', position: 4 } }] },
    back: { cards: [] } }] };
  const request = { requestId: 'request', constraints: { kind: 'pick', minimum: 1, maximum: 1 }, options: [
    { optionId: 'one', cardRef: faceDown }, { optionId: 'two', cardRef: faceUp },
    { optionId: 'three', cardRef: mismatch }, { optionId: 'four', zone: 'front', slot: 3 }
  ] };
  const interaction = buildInteractionRequest(request, model);
  assert.ok(interaction.options[0].targets.some(target => target.kind === 'slot' && target.slot === 2));
  assert.ok(interaction.options[1].targets.some(target => target.kind === 'slot' && target.slot === 3));
  assert.equal(interaction.options[2].targets.some(target => target.kind === 'slot'), false);
  assert.deepEqual(resolveInteractionTarget(interaction, { kind: 'slot', seatId: 'a', zone: 'front', slot: 3 }),
    { kind: 'ambiguous', optionIds: ['two', 'four'] });
});

test('R02: after a submit the UI adopts the read the session already took', () => {
  const base = setup();
  const wrapped = countedSession(base.session);
  const ui = createMatchUiController({ session: wrapped.session, viewerSeat: 'a' }).value;
  const endTurn = ui.read().value.model.legalActions.find(entry => entry.action?.type === 'endTurn');
  const queries = wrapped.counts.query;
  const after = ui.chooseAction(endTurn.actionId);
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.value.model.match.revision, 1);
  assert.equal(wrapped.counts.submit, 1);
  assert.equal(wrapped.counts.query, queries, 'the UI port was not asked for a second whole read');
  assert.equal(wrapped.counts.queryAction, 0);
});

test('R03/R04: another seat or a same-revision tutorial advance makes the UI read again, never reuse a stale model', () => {
  const base = setup();
  const wrapped = countedSession(base.session);
  const ui = createMatchUiController({ session: wrapped.session, viewerSeat: 'a' }).value;
  ui.read();
  const queries = wrapped.counts.query;
  ui.read(); ui.toggleLog(); ui.toggleLog();
  assert.equal(wrapped.counts.query, queries);
  const endTurn = ui.read().value.model.legalActions.find(entry => entry.action?.type === 'endTurn');
  base.port.submit({ commandId: 'a-end', expectedRevision: 0, action: endTurn.action });
  assert.equal(ui.read().value.model.match.revision, 1);
  assert.equal(wrapped.counts.query, queries, 'the own seat submit was adopted by the session');
  const other = base.session.port('b').value;
  const theirs = other.query().value;
  const theirEnd = theirs.legalActions.find(entry => entry.action?.type === 'endTurn');
  assert.equal(other.submit({ commandId: 'b-end', expectedRevision: theirs.status.revision, action: theirEnd.action }).ok, true);
  const changed = ui.read();
  assert.equal(changed.value.model.match.revision, 2);
  assert.equal(wrapped.counts.query, queries + 1, 'another seat moved the game, so the read is fetched once');

  const tutorial = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'ui-tutorial', seatIds: ['a', 'b'], seed: 71, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: { mode: 'tutorial' } } }).value;
  const counted = countedSession(tutorial);
  const tutorialUi = createMatchUiController({ session: counted.session, viewerSeat: 'a' }).value;
  const first = tutorialUi.read().value;
  const before = counted.counts.query;
  tutorialUi.toggleMenu(); tutorialUi.toggleMenu();
  assert.equal(counted.counts.query, before);
  for (let step = 0; step < 8; step += 1) assert.equal(tutorial.advanceTutorial().ok, true);
  const next = tutorialUi.read().value;
  assert.equal(next.model.match.revision, first.model.match.revision, 'the game revision did not move');
  assert.equal(counted.counts.query, before + 1, 'the new mode condition was read once');
  assert.ok(next.sync.modeEpoch > first.sync.modeEpoch);
});

test('I06: a long-press detail leaves the selection, the draft and its answer alone', () => {
  const { ui } = setup();
  const start = ui.read().value;
  const hand = start.model.seats[0].hand.cards;
  const execute = start.model.legalActions.find(entry => entry.actionType === 'executeCard');
  ui.selectCard(execute.base.cardRef);
  const planned = ui.chooseAction(execute.actionId).value;
  const optionId = planned.request.options[0].optionId;
  ui.toggleOption(optionId);
  const before = ui.read().value;
  const other = hand.find(card => card.cardRef !== execute.base.cardRef);
  const shown = ui.showDetail(other.cardRef);
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.equal(shown.value.model.ui.detailCardRef, other.cardRef);
  assert.equal(shown.value.model.ui.selectedCardRef, before.model.ui.selectedCardRef);
  assert.deepEqual(shown.value.selection, before.selection);
  assert.equal(shown.value.request.requestId, before.request.requestId);
  assert.deepEqual(shown.value.plan, before.plan);
  assert.equal(ui.showDetail('r:' + 'f'.repeat(32)).ok, false);
});

test('E01/IO-EVENT-02: the log history is copied only while it is open, and each event is logged once', () => {
  const { ui } = setup();
  const first = ui.read().value;
  assert.deepEqual(first.log, []);
  const endTurn = first.model.legalActions.find(entry => entry.action?.type === 'endTurn');
  const accepted = ui.chooseAction(endTurn.actionId).value;
  assert.ok(accepted.events.length > 0, 'events wait to be shown');
  assert.deepEqual(accepted.log, [], 'closed log: no history copy');
  ui.read(); ui.read();
  const opened = ui.toggleLog().value;
  const ids = opened.log.map(event => event.eventId);
  assert.ok(ids.length >= accepted.events.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ui.toggleLog().value.log, []);
  assert.deepEqual(ui.toggleLog().value.log.map(event => event.eventId), ids);
});

// The controller waits for a port whose writes answer later (the online session's shape); a local session stays synchronous.
function localSession() {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: 'gui-async', seatIds: ['a', 'b'], seed: 11, ruleVersion: '2.0', cardVersion: 'public',
    gameOptions: { mode: 'ai', playerDeckId: 'start-red', aiDeckId: 'start-yellow' } } });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.value;
}

// The same session, but its writes and questions answer on a later turn of the event loop, as a remote one does.
// `fail` makes the next one reject (a dropped connection).
function laterSession(session) {
  const state = { fail: false, asked: 0 };
  const later = value => new Promise((resolve, reject) => setTimeout(() => {
    if (state.fail) { state.fail = false; reject(Object.assign(new Error('gone'), { code: 'REMOTE_CLOSED' })); } else resolve(value);
  }, 5));
  const port = seat => {
    const bound = session.port(seat);
    if (!bound.ok) return bound;
    const local = bound.value;
    return { ok: true, value: { ...local,
      submit: command => { state.asked++; return later(local.submit(command)); },
      queryAction: input => { state.asked++; return later(local.queryAction(input)); },
      query: input => input?.inspectRef ? later(local.query(input)) : local.query(input) } };
  };
  return { remote: { ...session, port }, state };
}

// A play that is planned before it is sent (not a fixed action such as ending the turn).
const executeOf = read => read.value.model.legalActions.find(entry => entry.kind !== 'fixed');

test('a local session answers at once: no input returns a Promise', () => {
  const session = localSession();
  const ui = createMatchUiController({ session, viewerSeat: 'a' }).value;
  const planned = ui.chooseAction(executeOf(ui.read()).actionId);
  assert.equal(isThenable(planned), false);
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(isThenable(ui.back()), false);
  ui.dispose(); session.dispose();
});

test('a port that answers later: the input is awaited, a second tap meanwhile is refused, then one command commits', async () => {
  const session = localSession();
  const { remote, state } = laterSession(session);
  const ui = createMatchUiController({ session: remote, viewerSeat: 'a' }).value;
  const execute = executeOf(ui.read());
  const asking = ui.chooseAction(execute.actionId);
  assert.equal(isThenable(asking), true);
  // While the plan is out, input is refused at once and asks the port nothing; reading still works.
  const asked = state.asked;
  assert.deepEqual(ui.chooseAction(execute.actionId), { ok: false, error: { code: 'MATCH_UI_BUSY' } });
  assert.deepEqual(ui.confirm(), { ok: false, error: { code: 'MATCH_UI_BUSY' } });
  assert.equal(state.asked, asked);
  assert.equal(ui.read().ok, true);
  assert.equal(ui.toggleLog().ok, true);
  const planned = await asking;
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.ok(planned.value.request);
  // Picking an option asks the port nothing, so it answers at once.
  const picked = ui.toggleOption(planned.value.request.options[0].optionId);
  assert.equal(isThenable(picked), false);
  const ready = await ui.confirm();
  assert.ok(ready.value.plan.completion, JSON.stringify(ready));
  assert.equal(session.port('a').value.query().value.status.revision, 0);
  const sending = ui.confirm();
  assert.equal(ui.confirm().error.code, 'MATCH_UI_BUSY');
  const committed = await sending;
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.equal(committed.value.model.match.revision, 1);
  assert.equal(session.port('a').value.query().value.status.revision, 1);
  ui.dispose(); session.dispose();
});

test('a port that fails reads as a failure, and the next input goes through', async () => {
  const session = localSession();
  const { remote, state } = laterSession(session);
  const ui = createMatchUiController({ session: remote, viewerSeat: 'a' }).value;
  const execute = executeOf(ui.read());
  state.fail = true;
  assert.deepEqual(await ui.chooseAction(execute.actionId), { ok: false, error: { code: 'REMOTE_CLOSED' } });
  const again = await ui.chooseAction(execute.actionId);
  assert.equal(again.ok, true, JSON.stringify(again));
  ui.dispose(); session.dispose();
});

test('a plan that comes back after a new revision dropped its draft is stale', async () => {
  const session = localSession();
  const { remote } = laterSession(session);
  const ui = createMatchUiController({ session: remote, viewerSeat: 'a' }).value;
  const asking = ui.chooseAction(executeOf(ui.read()).actionId);
  // The match moves on while the plan is out (here: the turn ends by another route), and the screen reads it.
  assert.equal(session.port('a').value.submit({ commandId: 'external', expectedRevision: 0, action: { type: 'endTurn' } }).ok, true);
  assert.equal(ui.read().value.plan, null);
  assert.deepEqual(await asking, { ok: false, error: { code: 'MATCH_UI_PLAN_STALE' } });
  assert.equal(ui.read().value.plan, null);
  ui.dispose(); session.dispose();
});

test('flow runs straight through values that are here, and waits only for Promises', async () => {
  const seen = [];
  const now = flow(function* () { seen.push(yield 1); seen.push(yield 2); return 'done'; }());
  assert.equal(now, 'done');
  assert.deepEqual(seen, [1, 2]);
  const later = flow(function* () { const a = yield Promise.resolve(3); const b = yield 4; return a + b; }());
  assert.equal(isThenable(later), true);
  assert.equal(await later, 7);
  assert.equal(when(5, value => value + 1), 6);
  assert.equal(await when(Promise.resolve(5), value => value + 1), 6);
});
