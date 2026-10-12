import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeReferenceFrame } from '../src/game/runtime/reference-frame.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { createCommandJournal } from '../src/game/runtime/command-record.js';
import { createLocalRuntimeCoordinator } from '../src/adapters/local-runtime-port.js';
import { chooseSimpleAiIntent, runSimpleAiPortStep } from '../src/adapters/simple-ai-policy.js';
import { createRuntimeCui } from '../src/adapters/runtime-cui.js';
import { createRuntimeClientController } from '../src/adapters/runtime-client-controller.js';
import { normalizeBoardSlots } from '../src/game/board-slots.js';
import { prepareRuntimeCommand } from '../src/game/runtime/command-bridge.js';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';
import { actionPlanHtml } from '../src/ui-refresh/choice-read-view.js';
import {
  createAllocationSpec, createGroupedSelectionSpec, createRandomSelectionSpec,
  createSelectionRequest, createSelectionSpec, selectionRequestFromSpec
} from '../src/game/selection-model.js';

const refToken = index => `r:${index.toString(16).padStart(32, '0')}`;

function trackableCount(frame) {
  const entries = new Map(frame.cards.map(card => [card.identity.instanceId, card]));
  const root = (card, viewer) => card.location.kind === 'board'
    || card.location.kind === 'zone' && card.location.zone === 'hand' && card.controllerSeat === viewer
    || card.location.kind === 'zone' && ['registry', 'trash', 'ban'].includes(card.location.zone) && !card.faceDown;
  const tracked = (card, viewer) => {
    while (card.location.kind === 'mounted') {
      if (card.faceDown) return false;
      card = entries.get(card.location.host.instanceId);
      if (!card) return false;
    }
    return !card.faceDown && root(card, viewer);
  };
  return frame.cards.reduce((count, card) => count + frame.seatIds.filter(viewer => tracked(card, viewer)).length, 0);
}

function authority(configure = null, playerDeckRecipe = [['STD-224', 5], ['STD-020', 5]], aiDeckRecipe = [['STD-020', 10]], matchId = 'port-match') {
  const session = createRuntimeSession({
    matchId, seatIds: ['seat-a', 'seat-b'], seed: 31, ruleVersion: 'rules', cardVersion: 'cards',
    gameOptions: {
      mode: 'ai', playerDeckId: 'red', aiDeckId: 'yellow',
      playerDeckRecipe, aiDeckRecipe,
      playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
    }
  });
  assert.equal(session.ok, true, JSON.stringify(session));
  if (configure) configure(session.value.engineState);
  const frame = buildRuntimeReferenceFrame(session.value.engineState);
  assert.equal(frame.ok, true, JSON.stringify(frame));
  const references = createRuntimeReferenceState({
    frame: frame.value,
    newRefs: Array.from({ length: trackableCount(frame.value) }, (_, index) => refToken(index + 1))
  });
  assert.equal(references.ok, true, JSON.stringify(references));
  const journal = createCommandJournal({ matchId, seatIds: ['seat-a', 'seat-b'] });
  assert.equal(journal.ok, true, JSON.stringify(journal));
  return { ...session.value, referenceState: references.value, journal: journal.value };
}

function ports(customAuthority = authority()) {
  const coordinator = createLocalRuntimeCoordinator({ authority: customAuthority, sessionGeneration: 1 });
  assert.equal(coordinator.ok, true, JSON.stringify(coordinator));
  const first = coordinator.value.bind({ seatId: 'seat-a' });
  const second = coordinator.value.bind({ seatId: 'seat-b' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  return { coordinator: coordinator.value, first: first.value, second: second.value };
}

test('S05-LPORT-01: both bound seats query one shared authority without raw state or opponent hand cards', () => {
  const { first, second } = ports();
  const a = first.query();
  const b = second.query();
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual(Object.keys(a.value), ['status', 'observation', 'legalActions', 'requiredInput']);
  assert.equal(Object.hasOwn(a.value, 'authority'), false);
  assert.equal(Object.hasOwn(a.value, 'engineState'), false);
  assert.ok(Array.isArray(a.value.observation.seats[0].hand.cards));
  assert.equal(Object.hasOwn(a.value.observation.seats[1].hand, 'cards'), false);
  assert.ok(Array.isArray(b.value.observation.seats[1].hand.cards));
  assert.equal(Object.hasOwn(b.value.observation.seats[0].hand, 'cards'), false);
});

test('S05-LPORT-02: a bound submit advances shared authority and cannot spoof actor or match', () => {
  const { first, second } = ports();
  const before = first.query().value;
  const submitted = first.submit({ commandId: 'turn-1', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  assert.equal(submitted.value.kind, 'accepted');
  assert.equal(Object.hasOwn(submitted.value, 'authority'), false);
  assert.equal(second.query().value.status.revision, 1);
  assert.notEqual(second.query().value.status.activeSeat, before.status.activeSeat);
  assert.deepEqual(first.submit({
    commandId: 'spoof', expectedRevision: 1, action: { type: 'endTurn' }, actorSeat: 'seat-b'
  }), { ok: false, error: { code: 'INVALID_ADAPTER_INTENT' } });
});

test('S05-LPORT-03: RequiredInput is private to its answering port while waiting seat stays public', () => {
  const { first, second } = ports();
  const ownView = first.query().value.observation.seats[0];
  const plugin = ownView.hand.cards.find(card => card.definition.id === 'STD-224');
  assert.ok(plugin);
  const installed = first.submit({
    commandId: 'install-plugin', expectedRevision: 0, action: { type: 'install', cardRef: plugin.cardRef }
  });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  const owner = first.query().value;
  const opponent = second.query().value;
  assert.equal(owner.status.progress, 'awaitingInput');
  assert.equal(owner.status.requiredInput.seatId, 'seat-a');
  assert.equal(owner.requiredInput.canAnswer, true);
  assert.equal(owner.requiredInput.options.length, 8);
  assert.deepEqual(owner.requiredInput.constraints, {
    kind: 'pick', minimum: 1, maximum: 1, aggregate: null, groups: []
  });
  assert.equal(opponent.status.requiredInput.seatId, 'seat-a');
  assert.deepEqual(opponent.requiredInput, {
    kind: 'waiting', actorSeat: 'seat-a', canAnswer: false,
    options: [], constraints: { kind: 'waiting' }
  });
});

test('S05-LPORT-04: receipt lookup is actor-scoped and exact retry does not reapply', () => {
  const { first, second } = ports();
  const intent = { commandId: 'turn-1', expectedRevision: 0, action: { type: 'endTurn' } };
  const accepted = first.submit(intent);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const retry = first.submit(intent);
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.value.kind, 'retry');
  assert.deepEqual(first.receipt('turn-1'), { ok: true, value: accepted.value.receipt });
  assert.deepEqual(second.receipt('turn-1'), { ok: false, error: { code: 'RECEIPT_NOT_FOUND' } });
  assert.equal(second.query().value.status.revision, 1);
});

test('S05-LPORT-05: port and coordinator disposal revoke later query, submit, and receipt calls', () => {
  const { coordinator, first, second } = ports();
  assert.deepEqual(first.dispose(), { ok: true, value: null });
  assert.deepEqual(first.query(), { ok: false, error: { code: 'PORT_DISPOSED' } });
  assert.deepEqual(first.submit({ commandId: 'x', expectedRevision: 0, action: { type: 'endTurn' } }),
    { ok: false, error: { code: 'PORT_DISPOSED' } });
  assert.deepEqual(coordinator.dispose(), { ok: true, value: null });
  assert.deepEqual(second.receipt('x'), { ok: false, error: { code: 'PORT_DISPOSED' } });
  assert.deepEqual(coordinator.bind({ seatId: 'seat-a' }), { ok: false, error: { code: 'PORT_COORDINATOR_DISPOSED' } });
});

test('S05-LPORT-06: coordinator input getters are rejected without invocation', () => {
  let called = 0;
  const input = Object.defineProperty({ sessionGeneration: 1 }, 'authority', {
    enumerable: true, get() { called += 1; return authority(); }
  });
  assert.deepEqual(createLocalRuntimeCoordinator(input), { ok: false, error: { code: 'INVALID_LOCAL_RUNTIME' } });
  assert.equal(called, 0);
});

test('S05-LPORT-07: legal action catalog is active-seat only and every entry uses public refs', () => {
  const { first, second } = ports();
  const active = first.query();
  const inactive = second.query();
  assert.equal(active.ok, true, JSON.stringify(active));
  assert.equal(inactive.ok, true, JSON.stringify(inactive));
  assert.ok(active.value.legalActions.length > 0);
  assert.ok(active.value.legalActions.some(entry => entry.kind === 'fixed' && entry.action.type === 'endTurn'));
  assert.deepEqual(inactive.value.legalActions, []);
  for (const [index, entry] of active.value.legalActions.entries()) {
    assert.equal(entry.actionId, `action:0:${index + 1}`);
    assert.equal(JSON.stringify(entry).includes('rt:i:'), false);
    assert.equal(JSON.stringify(entry).includes('uid'), false);
  }
});

test('S05-LPORT-08: fixed CUI actionId resolves to the same bound semantic command', () => {
  const { first, second } = ports();
  const cui = createRuntimeCui(first);
  assert.equal(cui.ok, true, JSON.stringify(cui));
  const query = cui.value.read();
  const endTurn = query.value.legalActions.find(entry => entry.kind === 'fixed' && entry.action.type === 'endTurn');
  assert.ok(endTurn);
  const result = cui.value.execute({ commandId: 'cui-turn', kind: 'action', value: endTurn.actionId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.equal(second.query().value.status.revision, 1);
  assert.deepEqual(cui.value.execute({ commandId: 'bad', kind: 'action', value: 'action:0:999' }),
    { ok: false, error: { code: 'INVALID_CUI_COMMAND' } });
});

test('S05-LPORT-09: simple AI chooses and submits only from port query data', () => {
  const { first } = ports();
  const query = first.query();
  const intent = chooseSimpleAiIntent(query.value, 'ai-step-1');
  assert.equal(intent.ok, true, JSON.stringify(intent));
  assert.ok(query.value.legalActions.some(entry => entry.kind === 'fixed'
    && JSON.stringify(entry.action) === JSON.stringify(intent.value.action)));
  const result = runSimpleAiPortStep(first, 'ai-step-1');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
});

test('S05-LPORT-10: simple AI answers mandatory RequiredInput through option IDs', () => {
  const { first } = ports();
  const ownView = first.query().value.observation.seats[0];
  const plugin = ownView.hand.cards.find(card => card.definition.id === 'STD-224');
  const installed = first.submit({
    commandId: 'plugin-install', expectedRevision: 0, action: { type: 'install', cardRef: plugin.cardRef }
  });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  const waiting = first.query().value;
  assert.deepEqual(waiting.legalActions, []);
  const answered = runSimpleAiPortStep(first, 'plugin-answer');
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.value.kind, 'accepted');
  assert.equal(first.query().value.status.revision, 2);
});

function pendingSelectionAuthority(makeRequest) {
  return authority(state => {
    const candidates = state.players.player.hand.slice(0, 3).map(card => card.uid);
    state.pending = { type: 'selection', request: makeRequest(candidates) };
  });
}

test('S05-LPORT-11: grouped and aggregate choice constraints are complete public DTOs', () => {
  const grouped = ports(pendingSelectionAuthority(candidates => selectionRequestFromSpec(
    createGroupedSelectionSpec({ groups: [
      { candidates: candidates.slice(0, 2), minimum: 1, maximum: 1 },
      { candidates: candidates.slice(2), minimum: 1, maximum: 1 }
    ] }), { continuation: { type: 'test-group', playerId: 'player' } }
  ))).first.query().value.requiredInput;
  assert.equal(grouped.constraints.kind, 'pick');
  assert.deepEqual(grouped.constraints.groups.map(group => ({
    minimum: group.minimum, maximum: group.maximum, count: group.optionIds.length
  })), [
    { minimum: 1, maximum: 1, count: 2 },
    { minimum: 1, maximum: 1, count: 1 }
  ]);
  const groupIntent = chooseSimpleAiIntent({
    status: { revision: 0 }, legalActions: [], requiredInput: grouped
  }, 'group-answer');
  assert.equal(groupIntent.ok, true, JSON.stringify(groupIntent));
  assert.equal(groupIntent.value.action.optionIds.length, 2);

  const aggregate = ports(pendingSelectionAuthority(candidates => selectionRequestFromSpec(
    createSelectionSpec({
      candidates, minimum: 1, maximum: 2,
      aggregateConstraint: {
        comparator: '=', value: 3,
        candidateValues: Object.fromEntries(candidates.map((candidate, index) => [candidate, index + 1]))
      }
    }), { continuation: { type: 'test-aggregate', playerId: 'player' } }
  ))).first.query().value.requiredInput;
  assert.equal(aggregate.constraints.aggregate.comparator, '=');
  assert.equal(aggregate.constraints.aggregate.value, 3);
  const aggregateIntent = chooseSimpleAiIntent({
    status: { revision: 0 }, legalActions: [], requiredInput: aggregate
  }, 'aggregate-answer');
  assert.equal(aggregateIntent.ok, true, JSON.stringify(aggregateIntent));
  const selected = new Set(aggregateIntent.value.action.optionIds);
  const total = aggregate.constraints.aggregate.optionValues
    .filter(entry => selected.has(entry.optionId)).reduce((sum, entry) => sum + entry.value, 0);
  assert.equal(total, 3);
});

test('S05-LPORT-12: allocation and random constraints produce canonical AI answers', () => {
  const allocation = ports(pendingSelectionAuthority(candidates => selectionRequestFromSpec(
    createAllocationSpec({
      targets: candidates.slice(0, 2), total: 4,
      minimumPerTarget: 2, maximumPerTarget: 3, allowNoTargets: false
    }), { continuation: { type: 'test-allocation', playerId: 'player' } }
  ))).first.query().value.requiredInput;
  assert.deepEqual(allocation.constraints, {
    kind: 'allocation', total: 4, minimumPerOption: 2,
    maximumPerOption: 3, allowNoOptions: false,
    optionIds: allocation.options.map(option => option.optionId)
  });
  const allocationIntent = chooseSimpleAiIntent({
    status: { revision: 0 }, legalActions: [], requiredInput: allocation
  }, 'allocation-answer');
  assert.equal(allocationIntent.ok, true, JSON.stringify(allocationIntent));
  assert.deepEqual(allocationIntent.value.action.allocation.map(entry => entry.amount), [2, 2]);
  assert.deepEqual(allocationIntent.value.action.optionIds,
    allocationIntent.value.action.allocation.map(entry => entry.optionId));

  const random = ports(pendingSelectionAuthority(candidates => selectionRequestFromSpec(
    createRandomSelectionSpec({ pools: [{ candidates, count: 2 }], count: 2 }),
    { continuation: { type: 'test-random', playerId: 'player' } }
  ))).first.query().value.requiredInput;
  assert.deepEqual(random.options, []);
  assert.deepEqual(random.constraints, { kind: 'random', answer: 'commit-empty', count: 2 });
  const randomIntent = chooseSimpleAiIntent({
    status: { revision: 0 }, legalActions: [], requiredInput: random
  }, 'random-answer');
  assert.deepEqual(randomIntent.value.action.optionIds, []);
  assert.deepEqual(randomIntent.value.action.allocation, []);
});

function layeredAuthority(fillFront = false, matchId = 'port-match') {
  return authority(state => {
    const player = state.players.player;
    const all = [...player.hand, ...player.deck];
    const source = all.find(card => card.id === 'STD-205');
    const materials = all.filter(card => card.id === 'STD-020').slice(0, 2);
    assert.ok(source);
    assert.equal(materials.length, 2);
    const moved = new Set([source.uid, ...materials.map(card => card.uid)]);
    player.hand = player.hand.filter(card => !moved.has(card.uid));
    player.deck = player.deck.filter(card => !moved.has(card.uid));
    player.hand.unshift(source);
    source.color = null;
    player.front = [...materials];
    if (fillFront) player.front.push(...player.deck.splice(0, 3));
    player.memory = 30;
    normalizeBoardSlots(state);
  }, [['STD-205', 5], ['STD-020', 5]], [['STD-020', 10]], matchId);
}

test('S05-LPORT-13: layered intent plans materials before destinations and accepts extra material through CUI', () => {
  const { first } = ports(layeredAuthority());
  const cui = createRuntimeCui(first);
  const query = cui.value.read();
  assert.equal(query.ok, true, JSON.stringify(query));
  const template = query.value.legalActions.find(entry => entry.kind === 'intent'
    && entry.actionType === 'executeLayered');
  assert.ok(template, JSON.stringify(query.value.legalActions));
  const start = first.queryAction({ expectedRevision: 0, actionId: template.actionId, selections: [] });
  assert.equal(start.ok, true, JSON.stringify(start));
  const materials = start.value.selectionRequests[0];
  assert.equal(materials.constraints.assignment, 'exclusive');
  assert.equal(materials.constraints.minimum, 1);
  assert.equal(materials.options.length, 2);
  assert.equal(JSON.stringify(template).includes('rt:i:'), false);
  assert.equal(JSON.stringify(template).includes('uid'), false);

  const aiIntent = chooseSimpleAiIntent({
    ...query.value, legalActions: [template], requiredInput: null
  }, 'layered-ai', input => first.queryAction(input));
  assert.equal(aiIntent.ok, true, JSON.stringify(aiIntent));
  assert.equal(aiIntent.value.action.materialRefs.length, 1);

  const selections = [{ requestId: materials.requestId, optionIds: materials.options.map(option => option.optionId), allocation: [] }];
  const next = first.queryAction({ expectedRevision: 0, actionId: template.actionId, selections });
  assert.equal(next.ok, true, JSON.stringify(next));
  const destination = next.value.selectionRequests[0];
  selections.push({ requestId: destination.requestId, optionIds: [destination.options[0].optionId], allocation: [] });
  const result = cui.value.execute({ commandId: 'layered-cui', kind: 'plan', value: { actionId: template.actionId, selections } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.equal(first.query().value.status.revision, 1);
});

test('S05-LPORT-14: allocation option IDs must exactly match positive entries and reject without revision change', () => {
  const { first } = ports(pendingSelectionAuthority(candidates => selectionRequestFromSpec(
    createAllocationSpec({
      targets: candidates.slice(0, 2), total: 4,
      minimumPerTarget: 2, maximumPerTarget: 3, allowNoTargets: false
    }), { continuation: { type: 'test-allocation', playerId: 'player' } }
  )));
  const input = first.query().value.requiredInput;
  const result = first.submit({
    commandId: 'allocation-mismatch', expectedRevision: 0,
    action: {
      type: 'answerChoice', choiceId: input.choiceId,
      optionIds: [input.options[0].optionId],
      allocation: [{ optionId: input.options[1].optionId, amount: 4 }]
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'rejected');
  assert.equal(result.value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
  assert.equal(first.query().value.status.revision, 0);
});

test('S05-LPORT-15: scheduled controller advances a real bound port until seat handoff', () => {
  const { first } = ports();
  let serial = 0;
  const tasks = new Map();
  const scheduler = {
    schedule(task) { const token = ++serial; tasks.set(token, task); return token; },
    cancel(token) { tasks.delete(token); }
  };
  const created = createRuntimeClientController({ port: first, policy: chooseSimpleAiIntent, scheduler });
  assert.equal(created.ok, true, JSON.stringify(created));
  created.value.start();
  let steps = 0;
  while (tasks.size && steps < 30) {
    const [token, task] = tasks.entries().next().value;
    tasks.delete(token);
    task();
    steps += 1;
  }
  const after = first.query();
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.ok(after.value.status.revision > 0);
  assert.equal(after.value.status.activeSeat, 'seat-b');
  assert.equal(tasks.size, 0);
  assert.ok(steps < 30);
});

test('S05-LPORT-16: CUI text methods format current query and execute exact lines', () => {
  const { first } = ports();
  const cui = createRuntimeCui(first).value;
  const text = cui.readText();
  assert.equal(text.ok, true, JSON.stringify(text));
  assert.match(text.value, /STATUS ready REV 0 VIEW seat-a ACTIVE seat-a/);
  const endTurn = cui.read().value.legalActions.find(entry => entry.kind === 'fixed' && entry.action.type === 'endTurn');
  const result = cui.executeLine(`action text-turn ${endTurn.actionId}`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
  assert.deepEqual(cui.executeLine('action bad missing'), { ok: false, error: { code: 'INVALID_CUI_COMMAND' } });
});

function completePlanned(first, entry, selections = []) {
  const plan = first.queryAction({ expectedRevision: 0, actionId: entry.actionId, selections });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  if (plan.value.completion) return [plan.value.completion.action];
  const request = plan.value.selectionRequests[0];
  return request.options.flatMap(option => completePlanned(first, entry, [...selections, {
    requestId: request.requestId, optionIds: [option.optionId], allocation: []
  }]));
}

for (const cardId of ['STD-020', 'STD-129']) test(`S05-PLAN-01: planners equal exhaustive prepare oracle for ${cardId}`, () => {
  const current = authority(state => {
    for (const id of ['player', 'ai']) {
      const p = state.players[id];
      p.front = p.deck.splice(0, 2);
      p.back = p.deck.splice(0, 1);
      for (const card of [...p.front, ...p.back]) { card.faceDown = false; card.sleep = id === 'ai'; card.summoningSick = false; }
      p.registry.push(p.deck.shift());
      p.registry[0].faceDown = false;
      p.memory = 30;
    }
    normalizeBoardSlots(state);
  }, [[cardId, 15]], [[cardId, 15]]);
  const { first } = ports(current);
  const query = first.query().value;
  const own = query.observation.seats[0];
  const enemy = query.observation.seats[1];
  const candidates = [];
  for (const card of own.hand.cards) for (const zone of ['front', 'back']) for (let slot = 1; slot <= 5; slot += 1)
    candidates.push({ type: 'executeCard', cardRef: card.cardRef, destination: { zone, slot } });
  for (const zone of ['front', 'back']) for (const card of own[zone].cards) for (let slot = 1; slot <= 5; slot += 1)
    candidates.push({ type: 'redeploy', cardRef: card.cardRef, destination: { zone: zone === 'front' ? 'back' : 'front', slot } });
  for (const attacker of own.front.cards) for (const target of [
    { kind: 'user', seatId: 'seat-b' }, ...enemy.front.cards.map(card => ({ kind: 'card', cardRef: card.cardRef }))
  ]) candidates.push({ type: 'attack', attackerRef: attacker.cardRef, target });
  const oracle = candidates.filter((action, index) => prepareRuntimeCommand(current, {
    matchId: current.metadata.matchId, actorSeat: 'seat-a'
  }, { contractVersion: 1, matchId: current.metadata.matchId, actorSeat: 'seat-a', commandId: `oracle:${index}`,
    expectedRevision: 0, action }).ok);
  const planned = query.legalActions.filter(entry => entry.kind === 'intent').flatMap(entry => completePlanned(first, entry));
  const canonical = actions => actions.map(action => JSON.stringify(action)).sort();
  assert.deepEqual(canonical(planned), canonical(oracle));
});

test('S05-PLAN-02: draft reads are pure, detached, seat-bound and reject stale or forged selections', () => {
  const current = layeredAuthority();
  const { first, second } = ports(current);
  const before = JSON.stringify(current);
  const entry = first.query().value.legalActions.find(item => item.actionType === 'executeLayered');
  const args = { expectedRevision: 0, actionId: entry.actionId, selections: [] };
  const start = first.queryAction(args);
  assert.equal(start.ok, true);
  const request = start.value.selectionRequests[0];
  assert.deepEqual(second.queryAction(args), { ok: false, error: { code: 'ACTION_NOT_ALLOWED' } });
  assert.deepEqual(first.queryAction({ ...args, expectedRevision: 1 }), { ok: false, error: { code: 'STALE_REVISION' } });
  const bad = first.queryAction({ ...args, selections: [{ requestId: request.requestId, optionIds: ['forged'], allocation: [] }] });
  assert.equal(bad.ok, false);
  let getters = 0;
  const accessor = Object.defineProperty({ ...args }, 'actionId', { enumerable: true, get() { getters += 1; return entry.actionId; } });
  assert.equal(first.queryAction(accessor).ok, false);
  assert.equal(getters, 0);
  start.value.selectionRequests[0].options.length = 0;
  assert.equal(first.queryAction(args).value.selectionRequests[0].options.length, 2);
  assert.equal(JSON.stringify(current), before);
  const submitted = first.submit({ commandId: 'plan-expire', expectedRevision: 0, action: { type: 'endTurn' } });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  assert.deepEqual(first.queryAction(args), { ok: false, error: { code: 'STALE_REVISION' } });
  first.dispose();
  assert.deepEqual(first.queryAction(args), { ok: false, error: { code: 'PORT_DISPOSED' } });
});

test('S05-PLAN-03: layered materials free a filled slot and AI and CUI construct the same command', () => {
  const current = layeredAuthority(true);
  const p = current.engineState.players.player;
  assert.equal(p.front.length, p.user.frontLimit);
  const { first } = ports(current);
  const query = first.query().value;
  const entry = query.legalActions.find(item => item.actionType === 'executeLayered');
  const ai = chooseSimpleAiIntent({ ...query, legalActions: [entry] }, 'ai-plan', input => first.queryAction(input));
  assert.equal(ai.ok, true, JSON.stringify(ai));
  assert.equal(ai.value.action.materialRefs.length, 1);
  const source = p.hand.find(card => card.id === 'STD-205');
  const material = p.front.find(card => current.referenceState.entries.some(row => row.viewerSeat === 'seat-a'
    && row.cardRef === ai.value.action.materialRefs[0] && row.identity.instanceId === card.identity.instanceId));
  assert.ok(source && material);
  assert.equal(ai.value.action.destination.zone, 'front');
  assert.equal(ai.value.action.destination.slot, material.boardSlot);
  const cui = createRuntimeCui(first).value;
  const start = cui.readAction({ expectedRevision: 0, actionId: entry.actionId, selections: [] }).value;
  const materials = start.selectionRequests[0];
  const selections = [{ requestId: materials.requestId,
    optionIds: [materials.options.find(option => option.cardRef === ai.value.action.materialRefs[0]).optionId], allocation: [] }];
  const destination = cui.readAction({ expectedRevision: 0, actionId: entry.actionId, selections }).value.selectionRequests[0];
  selections.push({ requestId: destination.requestId,
    optionIds: [destination.options.find(option => option.zone === ai.value.action.destination.zone && option.slot === ai.value.action.destination.slot).optionId], allocation: [] });
  const planned = first.queryAction({ expectedRevision: 0, actionId: entry.actionId, selections }).value;
  assert.deepEqual(planned.completion.action, ai.value.action);
  const result = cui.executeLine(`plan cui-plan ${entry.actionId} ${selections.map(row => `${row.requestId}=${row.optionIds.join(',')}`).join(' ')}`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.kind, 'accepted');
});

test('S05-PLAN-04: changing materials invalidates the old destination request', () => {
  const { first } = ports(layeredAuthority(true));
  const entry = first.query().value.legalActions.find(item => item.actionType === 'executeLayered');
  const args = { expectedRevision: 0, actionId: entry.actionId, selections: [] };
  const request = first.queryAction(args).value.selectionRequests[0];
  const selection = index => ({ requestId: request.requestId, optionIds: [request.options[index].optionId], allocation: [] });
  const firstDestination = first.queryAction({ ...args, selections: [selection(0)] }).value.selectionRequests[0];
  const otherDestination = first.queryAction({ ...args, selections: [selection(1)] }).value.selectionRequests[0];
  assert.notEqual(firstDestination.requestId, otherDestination.requestId);
  assert.equal(first.queryAction({ ...args, selections: [selection(1), {
    requestId: firstDestination.requestId, optionIds: [firstDestination.options[0].optionId], allocation: []
  }] }).ok, false);
  const html = actionPlanHtml({ selectionRequests: [otherDestination] });
  assert.match(html, /data-selection-purpose="draft"/);
  assert.ok(html.includes(otherDestination.requestId));
  assert.equal(html.includes('rt:i:'), false);
});

test('S05-PLAN-05: exclusive group matching equals a small exhaustive test oracle', () => {
  const ids = ['a', 'b', 'c'];
  const oracle = (selected, groups, index = 0, counts = [0, 0]) => {
    if (index === selected.length) return groups.every((group, g) => counts[g] >= group.minimum && counts[g] <= group.maximum);
    return groups.some((group, g) => {
      if (!group.optionIds.includes(selected[index]) || counts[g] >= group.maximum) return false;
      const next = [...counts]; next[g] += 1;
      return oracle(selected, groups, index + 1, next);
    });
  };
  for (let maskA = 1; maskA < 8; maskA += 1) for (let maskB = 1; maskB < 8; maskB += 1) {
    const groups = [maskA, maskB].map(mask => ({ minimum: 1, maximum: 2, optionIds: ids.filter((_, index) => mask & (1 << index)) }));
    const request = { requestId: 'group', options: ids.map(optionId => ({ optionId })), constraints: {
      kind: 'pick', minimum: 0, maximum: 3, aggregate: null, assignment: 'exclusive', groups
    } };
    for (let selected = 0; selected < 8; selected += 1) {
      const optionIds = ids.filter((_, index) => selected & (1 << index));
      assert.equal(validSelectionAnswer(request, { requestId: 'group', optionIds, allocation: [] }), oracle(optionIds, groups),
        `${maskA}/${maskB}/${selected}`);
    }
  }
});

test('S05-PLAN-06: draft request scope cannot be replayed into a different match with identical ordinals', () => {
  const { first } = ports(layeredAuthority());
  const other = ports(layeredAuthority(false, 'different-match')).first;
  const entry = first.query().value.legalActions.find(item => item.actionType === 'executeLayered');
  const nextEntry = other.query().value.legalActions.find(item => item.actionType === 'executeLayered');
  assert.equal(entry.actionId, nextEntry.actionId);
  const request = first.queryAction({ expectedRevision: 0, actionId: entry.actionId, selections: [] }).value.selectionRequests[0];
  assert.equal(other.queryAction({ expectedRevision: 0, actionId: nextEntry.actionId, selections: [{
    requestId: request.requestId, optionIds: [request.options[0].optionId], allocation: []
  }] }).ok, false);
});
