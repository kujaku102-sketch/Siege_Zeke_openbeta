import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeClientController } from '../src/adapters/runtime-client-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { formatRuntimeCui, parseRuntimeCuiLine } from '../src/adapters/runtime-cui.js';

function scheduler() {
  let serial = 0;
  const tasks = new Map();
  return {
    api: {
      schedule(task) { const token = ++serial; tasks.set(token, task); return token; },
      cancel(token) { tasks.delete(token); }
    },
    get size() { return tasks.size; },
    runOne() {
      const entry = tasks.entries().next().value;
      if (!entry) return false;
      tasks.delete(entry[0]);
      entry[1]();
      return true;
    }
  };
}

function fixedQuery(overrides = {}) {
  return {
    status: {
      revision: 0, viewerSeat: 'seat-b', activeSeat: 'seat-b', progress: 'ready', finished: false,
      ...overrides.status
    },
    observation: {
      turnNumber: 1,
      seats: [
        { seatId: 'seat-a', fortressStr: 20, memory: { current: 5 }, deck: { count: 9 }, hand: { count: 1 }, front: { cards: [] }, back: { cards: [] }, registry: { cards: [] }, trash: { cards: [] }, ban: { cards: [] } },
        { seatId: 'seat-b', fortressStr: 20, memory: { current: 5 }, deck: { count: 9 }, hand: { count: 1, cards: [{ cardRef: 'r:bbbb', definition: { name: '公開手札' }, currentCost: 1 }] }, front: { cards: [] }, back: { cards: [] }, registry: { cards: [] }, trash: { cards: [] }, ban: { cards: [] } }
      ]
    },
    legalActions: [{ actionId: 'action:0:1', kind: 'fixed', action: { type: 'endTurn' } }],
    requiredInput: null,
    ...overrides
  };
}

function scriptedPort(queries, submitKind = 'accepted') {
  let queryIndex = 0;
  const submitted = [];
  return {
    submitted,
    query() { return { ok: true, value: queries[Math.min(queryIndex++, queries.length - 1)] }; },
    submit(intent) {
      submitted.push(structuredClone(intent));
      const rejected = submitKind === 'rejected' || submitKind === 'retry-rejected';
      return { ok: true, value: { kind: submitKind === 'retry-rejected' ? 'retry' : submitKind,
        receipt: { commandId: intent.commandId, status: rejected ? 'rejected' : 'accepted',
          reasonCode: rejected ? 'ACTION_NOT_ALLOWED' : 'ACCEPTED' } } };
    }
  };
}

test('S05-CLIENT-01: each scheduled controller step submits at most one port command', () => {
  const queue = scheduler();
  const port = scriptedPort([
    fixedQuery(),
    fixedQuery({ status: { revision: 1, viewerSeat: 'seat-b', activeSeat: 'seat-b', progress: 'ready', finished: false } }),
    fixedQuery({ status: { revision: 1, viewerSeat: 'seat-b', activeSeat: 'seat-b', progress: 'ready', finished: false } }),
    fixedQuery({ status: { revision: 2, viewerSeat: 'seat-b', activeSeat: 'seat-a', progress: 'ready', finished: false }, legalActions: [] })
  ]);
  const created = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler: queue.api });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(created.value.start(), { ok: true, value: { kind: 'scheduled' } });
  assert.equal(queue.size, 1);
  queue.runOne();
  assert.equal(port.submitted.length, 1);
  assert.equal(queue.size, 1);
  queue.runOne();
  assert.equal(port.submitted.length, 2);
  assert.equal(queue.size, 0);
  assert.notEqual(port.submitted[0].commandId, port.submitted[1].commandId);
});

test('S05-CLIENT-02: off-turn answering seat submits RequiredInput through the same policy', () => {
  const queue = scheduler();
  const choice = fixedQuery({
    status: {
      revision: 4, viewerSeat: 'seat-b', activeSeat: 'seat-a', progress: 'awaitingInput', finished: false,
      requiredInput: { kind: 'waiting', seatId: 'seat-b' }
    },
    legalActions: [],
    requiredInput: {
      choiceId: 'choice:4:response', kind: 'selection', canAnswer: true, optional: false,
      options: [{ optionId: 'option:1', kind: 'value', label: '応答' }],
      constraints: { kind: 'pick', minimum: 1, maximum: 1, aggregate: null, groups: [] }
    }
  });
  const port = scriptedPort([choice, fixedQuery({
    status: { revision: 5, viewerSeat: 'seat-b', activeSeat: 'seat-a', progress: 'ready', finished: false },
    legalActions: []
  })]);
  const controller = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler: queue.api }).value;
  controller.start();
  queue.runOne();
  assert.equal(port.submitted.length, 1);
  assert.deepEqual(port.submitted[0].action, {
    type: 'answerChoice', choiceId: 'choice:4:response', optionIds: ['option:1'], allocation: []
  });
});

test('S05-CLIENT-03: dispose cancels queued work and prevents later query or submit', () => {
  const queue = scheduler();
  const port = scriptedPort([fixedQuery()]);
  const controller = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler: queue.api }).value;
  controller.start();
  assert.equal(queue.size, 1);
  assert.deepEqual(controller.dispose(), { ok: true, value: null });
  assert.equal(queue.size, 0);
  assert.equal(queue.runOne(), false);
  assert.equal(port.submitted.length, 0);
  assert.deepEqual(controller.step(), { ok: false, error: { code: 'RUNTIME_CLIENT_CONTROLLER_DISPOSED' } });
});

test('S05-CLIENT-04: rejected commands stop without legacy fallback or reschedule', () => {
  const queue = scheduler();
  const port = scriptedPort([fixedQuery()], 'rejected');
  const controller = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler: queue.api }).value;
  controller.start();
  queue.runOne();
  assert.equal(port.submitted.length, 1);
  assert.equal(queue.size, 0);
});

test('S05-CLIENT-04B: retry carrying a rejected receipt also stops', () => {
  const queue = scheduler();
  const port = scriptedPort([fixedQuery()], 'retry-rejected');
  const controller = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler: queue.api }).value;
  const result = controller.step();
  assert.equal(result.ok, true);
  assert.equal(result.value.kind, 'stopped');
  assert.equal(queue.size, 0);
});

test('S05-CLIENT-05: malformed controller input and getters fail closed', () => {
  assert.deepEqual(createRuntimeClientController(null), {
    ok: false, error: { code: 'INVALID_RUNTIME_CLIENT_CONTROLLER' }
  });
  let called = 0;
  const input = Object.defineProperty({
    policy: chooseSimpleAiIntent, scheduler: scheduler().api
  }, 'port', { enumerable: true, get() { called += 1; return scriptedPort([fixedQuery()]); } });
  assert.deepEqual(createRuntimeClientController(input), {
    ok: false, error: { code: 'INVALID_RUNTIME_CLIENT_CONTROLLER' }
  });
  assert.equal(called, 0);
});

test('S05-CLIENT-06: grouped, allocation, random, and optional input remain policy-driven controller commands', () => {
  const cases = [
    {
      input: {
        choiceId: 'choice:1:group', kind: 'selection', canAnswer: true, optional: false,
        options: ['option:1', 'option:2'].map(optionId => ({ optionId, kind: 'value', label: optionId })),
        constraints: { kind: 'pick', minimum: 2, maximum: 2, aggregate: null, groups: [
          { groupId: 'group:1', minimum: 1, maximum: 1, optionIds: ['option:1'] },
          { groupId: 'group:2', minimum: 1, maximum: 1, optionIds: ['option:2'] }
        ], assignment: 'exclusive' }
      },
      check: action => assert.deepEqual(action.optionIds, ['option:1', 'option:2'])
    },
    {
      input: {
        choiceId: 'choice:1:allocation', kind: 'allocation', canAnswer: true, optional: false,
        options: ['option:1', 'option:2'].map(optionId => ({ optionId, kind: 'value', label: optionId })),
        constraints: { kind: 'allocation', total: 4, minimumPerOption: 2, maximumPerOption: 3,
          allowNoOptions: false, optionIds: ['option:1', 'option:2'] }
      },
      check: action => assert.deepEqual(action.allocation.map(entry => entry.amount), [2, 2])
    },
    {
      input: {
        choiceId: 'choice:1:random', kind: 'selection', canAnswer: true, optional: false,
        options: [], constraints: { kind: 'random', answer: 'commit-empty', count: 2 }
      },
      check: action => assert.deepEqual(action.optionIds, [])
    },
    {
      input: {
        choiceId: 'choice:1:security-rest', kind: 'selection', canAnswer: true, optional: true,
        options: [{ optionId: 'option:1', kind: 'card', cardRef: 'r:card', label: null }],
        constraints: { kind: 'pick', minimum: 0, maximum: 1, aggregate: null, groups: [] }
      },
      check: action => assert.equal(action.type, 'declineChoice')
    }
  ];
  for (const [index, fixture] of cases.entries()) {
    const waiting = fixedQuery({
      status: { revision: index, viewerSeat: 'seat-b', activeSeat: 'seat-a', progress: 'awaitingInput', finished: false,
        requiredInput: { kind: 'waiting', seatId: 'seat-b' } },
      legalActions: [], requiredInput: fixture.input
    });
    const port = scriptedPort([waiting, fixedQuery({
      status: { revision: index + 1, viewerSeat: 'seat-b', activeSeat: 'seat-a', progress: 'ready', finished: false },
      legalActions: []
    })]);
    const controller = createRuntimeClientController({ port, policy: chooseSimpleAiIntent, scheduler: scheduler().api }).value;
    const result = controller.step();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(port.submitted.length, 1);
    fixture.check(port.submitted[0].action);
  }
});

test('S05-CUI-01: exact line parser covers fixed, template, answer, and decline commands', () => {
  assert.deepEqual(parseRuntimeCuiLine('action cmd-1 action:0:2'), { ok: true, value: {
    commandId: 'cmd-1', kind: 'action', value: 'action:0:2'
  } });
  assert.deepEqual(parseRuntimeCuiLine('template cmd-2 action:1:4 option:1,option:2 destination:3'), { ok: true, value: {
    commandId: 'cmd-2', kind: 'template', value: {
      actionId: 'action:1:4', materialOptionIds: ['option:1', 'option:2'], destinationOptionId: 'destination:3'
    }
  } });
  assert.deepEqual(parseRuntimeCuiLine('answer cmd-3 choice:2:allocation option:1,option:2 option:1=2,option:2=2'), {
    ok: true, value: { commandId: 'cmd-3', kind: 'answer', value: {
      choiceId: 'choice:2:allocation', optionIds: ['option:1', 'option:2'],
      allocation: [{ optionId: 'option:1', amount: 2 }, { optionId: 'option:2', amount: 2 }]
    } }
  });
  assert.deepEqual(parseRuntimeCuiLine('decline cmd-4 choice:3:response-window'), { ok: true, value: {
    commandId: 'cmd-4', kind: 'decline', value: 'choice:3:response-window'
  } });
  for (const line of [
    ' action x y', 'action x y z', 'answer x choice option:1 bad=0', 'action x;rm y',
    'template x action:1 option:1, destination:1', 'answer x choice option:1, -',
    'answer x choice option:1 option:1=999999999999999999999999'
  ]) {
    assert.deepEqual(parseRuntimeCuiLine(line), { ok: false, error: { code: 'INVALID_CUI_LINE' } });
  }
});

test('S05-CUI-02: formatter uses projected data and cannot invent hidden opponent card details', () => {
  const formatted = formatRuntimeCui(fixedQuery());
  assert.equal(formatted.ok, true, JSON.stringify(formatted));
  assert.match(formatted.value, /HAND r:bbbb 公開手札/);
  assert.match(formatted.value, /SEAT seat-a .* HAND 1/);
  assert.equal(formatted.value.includes('相手の秘密'), false);
  assert.equal(formatted.value.includes('undefined'), false);
  assert.equal(formatted.value.includes('[object Object]'), false);
  const control = fixedQuery();
  control.observation.seats[1].hand.cards[0].definition.name = 'line\nbreak';
  assert.equal(formatRuntimeCui(control).value.includes('line\nbreak'), false);
});
