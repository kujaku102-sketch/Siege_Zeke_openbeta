import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeCommand, classifyCommand, createCommandJournal, recordTerminal } from '../src/game/runtime/command-record.js';

const baseCommand = (overrides = {}) => ({
  contractVersion: 1, matchId: 'match-a', commandId: 'command-a', actorSeat: 'seat-a', expectedRevision: 0,
  action: { type: 'endTurn' }, ...overrides
});
const context = { matchId: 'match-a', actorSeat: 'seat-a' };
const newJournal = () => createCommandJournal({ matchId: 'match-a', seatIds: ['seat-a', 'seat-b'] }).value;
const code = (result, expected) => assert.deepEqual(result, { ok: false, error: { code: expected } });
const accepted = { status: 'accepted', revision: 1, reasonCode: 'ACCEPTED' };
const rejected = { status: 'rejected', revision: 0, reasonCode: 'UNSUPPORTED_ACTION' };
const activateScriptCommand = (overrides = {}) => baseCommand({
  action: { type: 'activateScript', cardRef: `r:${'a'.repeat(32)}` }, ...overrides
});
const activateTurboCommand = (overrides = {}) => baseCommand({
  action: { type: 'activateAbility', ability: { kind: 'user', key: 'turbo' } }, ...overrides
});

test('S03-REC-01: creates an exact empty journal from ordered distinct seats', () => {
  assert.deepEqual(createCommandJournal({ matchId: 'm', seatIds: ['a', 'b'] }), {
    ok: true, value: { schemaVersion: 1, matchId: 'm', seatIds: ['a', 'b'], entries: [] }
  });
  code(createCommandJournal({ matchId: 'm', seatIds: ['a', 'a'] }), 'INVALID_COMMAND');
});

test('S03-REC-02: canonicalizes only endTurn and sorts object keys by code unit', () => {
  const result = canonicalizeCommand(baseCommand());
  assert.equal(result.ok, true);
  assert.equal(result.value.canonicalPayload, '{"action":{"type":"endTurn"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}');
});

test('S03-REC-03: rejects non-exact envelope and action fields without invoking accessors', () => {
  code(canonicalizeCommand({ ...baseCommand(), trace: 'x' }), 'INVALID_COMMAND');
  code(canonicalizeCommand(baseCommand({ action: { type: 'endTurn', free: true } })), 'INVALID_COMMAND');
  let invoked = false;
  const input = baseCommand();
  Object.defineProperty(input, 'trace', { enumerable: true, get() { invoked = true; return 'x'; } });
  code(canonicalizeCommand(input), 'INVALID_COMMAND');
  assert.equal(invoked, false);
});

test('S03-REC-04: distinguishes unsupported contract versions from malformed versions', () => {
  code(canonicalizeCommand(baseCommand({ contractVersion: 2 })), 'UNSUPPORTED_CONTRACT');
  code(canonicalizeCommand(baseCommand({ contractVersion: 1.5 })), 'INVALID_COMMAND');
  code(canonicalizeCommand(baseCommand({ contractVersion: 2, matchId: '' })), 'UNSUPPORTED_CONTRACT');
  code(canonicalizeCommand(baseCommand({ contractVersion: '2', matchId: '' })), 'INVALID_COMMAND');
  code(canonicalizeCommand({ ...baseCommand({ contractVersion: 2 }), extra: true }), 'INVALID_COMMAND');
  const malformedAction = baseCommand({ contractVersion: 2 });
  Object.defineProperty(malformedAction.action, 'type', { enumerable: true, get() { throw new Error('action must not be read'); } });
  code(canonicalizeCommand(malformedAction), 'UNSUPPORTED_CONTRACT');
});

test('S03-REC-05: known non-endTurn action families remain unavailable, never generic', () => {
  for (const type of ['executeLayered',
    'attack', 'answerChoice', 'declineChoice', 'sandboxAddCard']) {
    code(canonicalizeCommand(baseCommand({ action: { type, target: 'card-1' } })), 'ACTION_SCHEMA_UNAVAILABLE');
  }
  for (const type of ['playCard', 'activate', 'pass', 'move', 'unknownAction']) {
    code(canonicalizeCommand(baseCommand({ action: { type } })), 'INVALID_COMMAND');
  }
});

test('S03-REC-06: validates scalar strings and safe revision including negative zero', () => {
  for (const expectedRevision of [-0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    code(canonicalizeCommand(baseCommand({ expectedRevision })), 'INVALID_COMMAND');
  }
  code(canonicalizeCommand(baseCommand({ commandId: '' })), 'INVALID_COMMAND');
  assert.equal(canonicalizeCommand(baseCommand({ expectedRevision: Number.MAX_SAFE_INTEGER })).ok, true);
});

test('S03-REC-07: canonical result is a detached copy and inputs stay unchanged', () => {
  const command = baseCommand();
  const before = structuredClone(command);
  const result = canonicalizeCommand(command);
  result.value.command.action.type = 'changed';
  assert.deepEqual(command, before);
});

test('S03-REC-08: authorized new command is classified before any terminal exists', () => {
  assert.deepEqual(classifyCommand(newJournal(), context, baseCommand()), { ok: true, value: { kind: 'new' } });
});

test('S03-REC-09: authorization precedes journal entry lookup and does not disclose entries', () => {
  const journal = newJournal();
  const recorded = recordTerminal(journal, context, baseCommand(), rejected);
  code(classifyCommand(recorded.value, { matchId: 'match-a', actorSeat: 'seat-b' }, baseCommand()), 'NOT_AUTHORIZED');
  let entriesRead = false;
  const hiddenEntries = new Proxy([], { getPrototypeOf() { entriesRead = true; throw new Error('entries must stay unread'); } });
  const scoped = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-b', 'seat-c'], entries: hiddenEntries };
  code(classifyCommand(scoped, { matchId: 'match-a', actorSeat: 'seat-a' }, baseCommand()), 'NOT_AUTHORIZED');
  assert.equal(entriesRead, false);
});

test('S03-REC-10: malformed journal is rejected only after matching trusted scope', () => {
  const fakeArray = values => {
    const value = Object.create(Array.prototype);
    Object.defineProperty(value, 'length', { value: values.length, writable: true, enumerable: false, configurable: false });
    values.forEach((item, index) => Object.defineProperty(value, String(index), {
      value: item, writable: true, enumerable: true, configurable: true
    }));
    return value;
  };
  const malformed = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], entries: [{}] };
  code(classifyCommand(malformed, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 42, seatIds: ['seat-a', 'seat-b'], entries: [] }, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a'], entries: [] }, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], entries: [], extra: true }, context, baseCommand()), 'INVALID_JOURNAL');
  const hiddenHeader = { schemaVersion: 1, seatIds: ['seat-a', 'seat-b'], entries: [] };
  Object.defineProperty(hiddenHeader, 'matchId', { enumerable: true, get() { throw new Error('must not invoke'); } });
  code(classifyCommand(hiddenHeader, context, baseCommand()), 'INVALID_JOURNAL');
  let getterCalls = 0;
  const accessorEntries = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'] };
  Object.defineProperty(accessorEntries, 'entries', { enumerable: true, get() { getterCalls += 1; return []; } });
  code(classifyCommand(accessorEntries, context, baseCommand()), 'INVALID_JOURNAL');
  assert.equal(getterCalls, 0);
  const hiddenEntries = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'] };
  Object.defineProperty(hiddenEntries, 'entries', { value: [], enumerable: false });
  code(classifyCommand(hiddenEntries, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], entries: {} }, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 'match-a', seatIds: fakeArray(['seat-a', 'seat-b']), entries: [] }, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], entries: fakeArray([]) }, context, baseCommand()), 'INVALID_JOURNAL');
  code(classifyCommand({ schemaVersion: 1, matchId: 'other', seatIds: ['seat-a', 'seat-b'], entries: [] }, context, baseCommand()), 'NOT_AUTHORIZED');
  code(classifyCommand({ schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-b', 'seat-c'], entries: [] }, context, baseCommand()), 'NOT_AUTHORIZED');
  code(classifyCommand(malformed, { matchId: 'other', actorSeat: 'seat-a' }, baseCommand({ matchId: 'other' })), 'NOT_AUTHORIZED');
});

test('S03-REC-11: exact same actor and payload retry returns a detached original receipt', () => {
  const journal = recordTerminal(newJournal(), context, baseCommand(), rejected).value;
  const retried = classifyCommand(journal, context, baseCommand());
  assert.deepEqual(retried, { ok: true, value: { kind: 'retry', receipt: journal.entries[0].receipt } });
  retried.value.receipt.reasonCode = 'changed';
  assert.equal(journal.entries[0].receipt.reasonCode, 'UNSUPPORTED_ACTION');
  const acceptedJournal = recordTerminal(newJournal(), context, baseCommand(), accepted).value;
  const acceptedRetry = classifyCommand(acceptedJournal, context, baseCommand());
  assert.deepEqual(acceptedRetry.value.receipt, acceptedJournal.entries[0].receipt);
  acceptedRetry.value.receipt.revision = 99;
  assert.equal(acceptedJournal.entries[0].receipt.revision, 1);
});

test('S03-REC-12: command ID collisions never replace or reveal the old receipt', () => {
  const journal = recordTerminal(newJournal(), context, baseCommand(), rejected).value;
  code(classifyCommand(journal, context, baseCommand({ expectedRevision: 1 })), 'COMMAND_ID_COLLISION');
  code(classifyCommand(journal, { matchId: 'match-a', actorSeat: 'seat-b' }, baseCommand({ actorSeat: 'seat-b' })), 'COMMAND_ID_COLLISION');
  assert.equal(journal.entries.length, 1);
});

test('S03-REC-13: context mismatch and unregistered actor are not authorized', () => {
  code(classifyCommand(newJournal(), { matchId: 'other', actorSeat: 'seat-a' }, baseCommand()), 'NOT_AUTHORIZED');
  code(classifyCommand(newJournal(), { matchId: 'match-a', actorSeat: 'seat-b' }, baseCommand()), 'NOT_AUTHORIZED');
  code(classifyCommand(newJournal(), { matchId: 'match-a', actorSeat: 'seat-x' }, baseCommand({ actorSeat: 'seat-x' })), 'NOT_AUTHORIZED');
  let getterCalls = 0;
  const accessorEntries = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'] };
  Object.defineProperty(accessorEntries, 'entries', { enumerable: true, get() { getterCalls += 1; return []; } });
  code(classifyCommand(accessorEntries, { matchId: 'match-a', actorSeat: 'seat-x' }, baseCommand({ actorSeat: 'seat-x' })), 'NOT_AUTHORIZED');
  const hiddenEntries = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'] };
  Object.defineProperty(hiddenEntries, 'entries', { value: [], enumerable: false });
  code(classifyCommand(hiddenEntries, { matchId: 'match-a', actorSeat: 'seat-x' }, baseCommand({ actorSeat: 'seat-x' })), 'NOT_AUTHORIZED');
  const malformedEntries = { schemaVersion: 1, matchId: 'match-a', seatIds: ['seat-a', 'seat-b'], entries: new Proxy({}, {
    getPrototypeOf() { getterCalls += 1; throw new Error('entries must remain unread'); }
  }) };
  code(classifyCommand(malformedEntries, { matchId: 'match-a', actorSeat: 'seat-x' }, baseCommand({ actorSeat: 'seat-x' })), 'NOT_AUTHORIZED');
  assert.equal(getterCalls, 0);
});

test('S03-REC-14: journal rejects duplicate IDs and inconsistent entry identities', () => {
  const once = recordTerminal(newJournal(), context, baseCommand(), rejected).value;
  const duplicate = structuredClone(once); duplicate.entries.push(duplicate.entries[0]);
  code(classifyCommand(duplicate, context, baseCommand({ commandId: 'other' })), 'INVALID_JOURNAL');
  const drift = structuredClone(once); drift.entries[0].actorSeat = 'seat-b';
  code(classifyCommand(drift, context, baseCommand({ commandId: 'other' })), 'INVALID_JOURNAL');
  const corruptReceipt = structuredClone(once); corruptReceipt.entries[0].receipt.reasonCode = 'PRIVATE_DETAIL';
  code(classifyCommand(corruptReceipt, context, baseCommand({ commandId: 'other' })), 'INVALID_JOURNAL');
});

test('S03-REC-15: journal canonical payload must parse and exactly recanonicalize', () => {
  const journal = recordTerminal(newJournal(), context, baseCommand(), rejected).value;
  const malformed = structuredClone(journal); malformed.entries[0].canonicalPayload = '{';
  code(classifyCommand(malformed, context, baseCommand({ commandId: 'other' })), 'INVALID_JOURNAL');
  const reordered = structuredClone(journal); reordered.entries[0].canonicalPayload = JSON.stringify(baseCommand());
  code(classifyCommand(reordered, context, baseCommand({ commandId: 'other' })), 'INVALID_JOURNAL');
  const duplicateKeys = structuredClone(journal);
  duplicateKeys.entries[0].canonicalPayload = '{"action":{"type":"endTurn"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a","matchId":"match-a"}';
  code(classifyCommand(duplicateKeys, context, baseCommand({ commandId: 'other' })), 'INVALID_JOURNAL');
  const parser = JSON.parse;
  const failure = new Error('unexpected parser failure');
  try {
    JSON.parse = () => { throw failure; };
    assert.throws(() => classifyCommand(journal, context, baseCommand({ commandId: 'other' })), error => error === failure);
  } finally { JSON.parse = parser; }
});

test('S03-REC-16: terminal accepted and rejected summaries enforce exact result semantics', () => {
  const acceptedJournal = recordTerminal(newJournal(), context, baseCommand(), accepted);
  assert.equal(acceptedJournal.ok, true);
  for (const terminal of [
    { status: 'accepted', revision: 0, reasonCode: 'ACCEPTED' },
    { status: 'accepted', revision: 1, reasonCode: 'STALE_REVISION' },
    { status: 'rejected', revision: 0, reasonCode: 'PRIVATE_DETAIL' },
    { status: 'accepted', revision: 1, reasonCode: 'ACCEPTED', privateView: {} }
  ]) code(recordTerminal(newJournal(), context, baseCommand(), terminal), 'INVALID_TERMINAL');
});

test('S03-REC-17: retry cannot be recorded twice and accepted revision overflow is rejected', () => {
  const first = recordTerminal(newJournal(), context, baseCommand(), rejected).value;
  code(recordTerminal(first, context, baseCommand(), rejected), 'COMMAND_ALREADY_RECORDED');
  const maxCommand = baseCommand({ expectedRevision: Number.MAX_SAFE_INTEGER });
  code(recordTerminal(newJournal(), context, maxCommand, accepted), 'REVISION_EXHAUSTED');
  const lastCommand = baseCommand({ expectedRevision: Number.MAX_SAFE_INTEGER - 1 });
  const last = recordTerminal(newJournal(), context, lastCommand, {
    status: 'accepted', revision: Number.MAX_SAFE_INTEGER, reasonCode: 'ACCEPTED'
  });
  assert.equal(last.ok, true);
  assert.equal(classifyCommand(last.value, context, lastCommand).value.kind, 'retry');
});

test('S03-REC-18: strict data descriptors, frozen values, shared copies, cycles, and reflection errors', () => {
  const frozen = Object.freeze(baseCommand());
  assert.equal(canonicalizeCommand(frozen).ok, true);
  const symbol = baseCommand(); symbol[Symbol('extra')] = true;
  code(canonicalizeCommand(symbol), 'INVALID_COMMAND');
  const cycle = baseCommand(); cycle.action.self = cycle;
  code(canonicalizeCommand(cycle), 'INVALID_COMMAND');
  const failure = new Error('reflection');
  assert.throws(() => canonicalizeCommand(new Proxy(baseCommand(), { getPrototypeOf() { throw failure; } })), error => error === failure);
});

const restCommand = (overrides = {}) => baseCommand({ action: { type: 'restSecurity', cardRef: `r:${'a'.repeat(32)}` }, ...overrides });
const installCommand = (overrides = {}) => baseCommand({ action: { type: 'install', cardRef: `r:${'d'.repeat(32)}` }, ...overrides });
const recoverCommand = (overrides = {}) => baseCommand({ action: { type: 'recoverRegistry', cardRef: `r:${'e'.repeat(32)}` }, ...overrides });

test('S03-REC-19: canonicalizes restSecurity with one exact opaque reference token', () => {
  const result = canonicalizeCommand(restCommand());
  assert.equal(result.ok, true);
  assert.equal(result.value.command.action.type, 'restSecurity');
  assert.equal(result.value.canonicalPayload, `{"action":{"cardRef":"r:${'a'.repeat(32)}","type":"restSecurity"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`);
});

test('S03-REC-20: restSecurity rejects malformed, nonprimitive, or extra reference fields', () => {
  for (const cardRef of ['', `r:${'A'.repeat(32)}`, `r:${'a'.repeat(31)}`, `r:${'a'.repeat(33)}`, new String(`r:${'a'.repeat(32)}`), null]) {
    code(canonicalizeCommand(restCommand({ action: { type: 'restSecurity', cardRef } })), 'INVALID_COMMAND');
  }
  code(canonicalizeCommand(restCommand({ action: { type: 'restSecurity', cardRef: `r:${'a'.repeat(32)}`, uid: 'rt:i:1' } })), 'INVALID_COMMAND');
  code(canonicalizeCommand(restCommand({ action: { type: 'restSecurity' } })), 'INVALID_COMMAND');
});

test('S03-REC-21: restSecurity removes only its unavailable marker and unknown actions remain invalid', () => {
  assert.equal(canonicalizeCommand(restCommand()).ok, true);
  for (const type of ['rest', 'restSecurityCard', 'playCard']) {
    code(canonicalizeCommand(baseCommand({ action: { type } })), 'INVALID_COMMAND');
  }
  code(canonicalizeCommand(baseCommand({ action: { type: 'executeCard' } })), 'INVALID_COMMAND');
});

test('S03-REC-22: restSecurity canonical payload survives journal record and exact retry', () => {
  const command = restCommand();
  const journal = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(journal.ok, true);
  assert.equal(classifyCommand(journal.value, context, command).value.kind, 'retry');
  assert.deepEqual(recordTerminal(journal.value, context, command, rejected), { ok: false, error: { code: 'COMMAND_ALREADY_RECORDED' } });
});

test('S03-REC-23: restSecurity commands retain v1 contract and strict canonical ordering', () => {
  const input = restCommand({ commandId: 'z', action: { type: 'restSecurity', cardRef: `r:${'b'.repeat(32)}` } });
  const output = canonicalizeCommand(input);
  assert.equal(output.ok, true);
  assert.equal(output.value.command.contractVersion, 1);
  assert.equal(output.value.canonicalPayload.indexOf('"cardRef"') < output.value.canonicalPayload.indexOf('"type"'), true);
});

test('S03-REC-24: frozen restSecurity envelope is detached and malformed tokens never enter receipts', () => {
  const input = Object.freeze(restCommand());
  const output = canonicalizeCommand(input);
  assert.equal(output.ok, true);
  output.value.command.action.cardRef = `r:${'c'.repeat(32)}`;
  assert.equal(input.action.cardRef, `r:${'a'.repeat(32)}`);
});

test('S03-REC-25: install shares only the exact opaque-reference schema', () => {
  const result = canonicalizeCommand(installCommand());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.command.action, { type: 'install', cardRef: `r:${'d'.repeat(32)}` });
  assert.equal(result.value.canonicalPayload, `{"action":{"cardRef":"r:${'d'.repeat(32)}","type":"install"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`);
  for (const action of [
    { type: 'install' },
    { type: 'install', cardRef: `r:${'D'.repeat(32)}` },
    { type: 'install', cardRef: `r:${'d'.repeat(32)}`, force: true },
    { type: 'install', cardRef: `r:${'d'.repeat(32)}`, uid: 'rt:i:1' }
  ]) code(canonicalizeCommand(installCommand({ action })), 'INVALID_COMMAND');
});

test('S03-REC-26: install alone leaves the remaining known families unavailable', () => {
  assert.equal(canonicalizeCommand(installCommand()).ok, true);
  for (const type of ['executeLayered',
    'attack', 'answerChoice', 'declineChoice', 'sandboxAddCard']) {
    code(canonicalizeCommand(baseCommand({ action: { type } })), 'ACTION_SCHEMA_UNAVAILABLE');
  }
});

test('S03-REC-27: install canonical payload records and retries without changing v1 semantics', () => {
  const command = installCommand();
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  const retry = classifyCommand(recorded.value, context, command);
  assert.equal(retry.ok, true);
  assert.equal(retry.value.kind, 'retry');
  assert.equal(retry.value.receipt.revision, 0);
  assert.equal(canonicalizeCommand(command).value.command.contractVersion, 1);
});

test('S03-REC-28: recoverRegistry uses only the exact opaque-reference schema', () => {
  const result = canonicalizeCommand(recoverCommand());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.command.action, { type: 'recoverRegistry', cardRef: `r:${'e'.repeat(32)}` });
  assert.equal(result.value.canonicalPayload, `{"action":{"cardRef":"r:${'e'.repeat(32)}","type":"recoverRegistry"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`);
  for (const action of [
    { type: 'recoverRegistry' },
    { type: 'recoverRegistry', cardRef: `r:${'E'.repeat(32)}` },
    { type: 'recoverRegistry', cardRef: `r:${'e'.repeat(32)}`, force: true },
    { type: 'recoverRegistry', cardRef: `r:${'e'.repeat(32)}`, uid: 'rt:i:1' }
  ]) code(canonicalizeCommand(recoverCommand({ action })), 'INVALID_COMMAND');
});

test('S03-REC-29: recoverRegistry opens no other known action family', () => {
  assert.equal(canonicalizeCommand(recoverCommand()).ok, true);
  for (const type of ['executeLayered',
    'attack', 'answerChoice', 'declineChoice', 'sandboxAddCard']) {
    code(canonicalizeCommand(baseCommand({ action: { type } })), 'ACTION_SCHEMA_UNAVAILABLE');
  }
});

test('S03-REC-30: recoverRegistry payload records and retries under the v1 contract', () => {
  const command = recoverCommand();
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  const retry = classifyCommand(recorded.value, context, command);
  assert.equal(retry.ok, true);
  assert.equal(retry.value.kind, 'retry');
  assert.equal(retry.value.receipt.revision, 0);
  assert.equal(canonicalizeCommand(command).value.command.contractVersion, 1);
});

test('S03-REC-31: activateScript uses only the exact reference action and participates in retry', () => {
  const command = activateScriptCommand();
  const output = canonicalizeCommand(command);
  assert.equal(output.ok, true);
  assert.deepEqual(output.value.command.action, { type: 'activateScript', cardRef: `r:${'a'.repeat(32)}` });
  assert.equal(output.value.canonicalPayload,
    `{"action":{"cardRef":"r:${'a'.repeat(32)}","type":"activateScript"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`);
  for (const action of [
    { type: 'activateScript' },
    { type: 'activateScript', cardRef: `r:${'A'.repeat(32)}` },
    { type: 'activateScript', cardRef: `r:${'a'.repeat(32)}`, force: true },
    { type: 'activateScript', cardRef: `r:${'a'.repeat(32)}`, uid: 'rt:i:1' }
  ]) code(canonicalizeCommand(activateScriptCommand({ action })), 'INVALID_COMMAND');
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  assert.equal(classifyCommand(recorded.value, context, command).value.kind, 'retry');
  assert.deepEqual(recordTerminal(recorded.value, context, command, rejected),
    { ok: false, error: { code: 'COMMAND_ALREADY_RECORDED' } });
});

test('S03-REC-32: executeCard canonicalizes one exact destination and rejects internal controls', () => {
  const cardRef = `r:${'f'.repeat(32)}`;
  const command = baseCommand({ action: { type: 'executeCard', cardRef, destination: { zone: 'back', slot: 4 } } });
  const output = canonicalizeCommand(command);
  assert.equal(output.ok, true);
  assert.deepEqual(output.value.command.action,
    { type: 'executeCard', cardRef, destination: { zone: 'back', slot: 4 } });
  assert.equal(output.value.canonicalPayload,
    `{"action":{"cardRef":"${cardRef}","destination":{"slot":4,"zone":"back"},"type":"executeCard"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`);
  for (const action of [
    { type: 'executeCard', cardRef },
    { type: 'executeCard', cardRef, destination: { zone: 'front' } },
    { type: 'executeCard', cardRef, destination: { zone: 'front', slot: 1, force: true } },
    { type: 'executeCard', cardRef, destination: { zone: 'registry', slot: 1 } },
    { type: 'executeCard', cardRef, destination: { zone: 'front', slot: 0 } },
    { type: 'executeCard', cardRef, destination: { zone: 'front', slot: -0 } },
    { type: 'executeCard', cardRef, destination: { zone: 'front', slot: 1.5 } },
    { type: 'executeCard', cardRef, destination: { zone: 'front', slot: 1 }, free: true }
  ]) code(canonicalizeCommand(baseCommand({ action })), 'INVALID_COMMAND');
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  assert.equal(classifyCommand(recorded.value, context, command).value.kind, 'retry');
  const collision = structuredClone(command);
  collision.action.destination.slot = 5;
  code(classifyCommand(recorded.value, context, collision), 'COMMAND_ID_COLLISION');
});

test('S03-REC-33: redeploy shares the exact opaque reference and destination schema', () => {
  const cardRef = `r:${'9'.repeat(32)}`;
  const command = baseCommand({ action: { type: 'redeploy', cardRef, destination: { zone: 'front', slot: 3 } } });
  const output = canonicalizeCommand(command);
  assert.equal(output.ok, true);
  assert.deepEqual(output.value.command.action,
    { type: 'redeploy', cardRef, destination: { zone: 'front', slot: 3 } });
  assert.equal(output.value.canonicalPayload,
    `{"action":{"cardRef":"${cardRef}","destination":{"slot":3,"zone":"front"},"type":"redeploy"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}`);
  for (const action of [
    { type: 'redeploy', cardRef },
    { type: 'redeploy', cardRef, destination: { zone: 'front' } },
    { type: 'redeploy', cardRef, destination: { zone: 'registry', slot: 1 } },
    { type: 'redeploy', cardRef, destination: { zone: 'back', slot: 0 } },
    { type: 'redeploy', cardRef, destination: { zone: 'back', slot: 1 }, useLayerDiscount: true },
    { type: 'redeploy', cardRef, destination: { zone: 'back', slot: 1 }, layerUid: 'rt:i:2' }
  ]) code(canonicalizeCommand(baseCommand({ action })), 'INVALID_COMMAND');
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  assert.equal(classifyCommand(recorded.value, context, command).value.kind, 'retry');
  const collision = structuredClone(command);
  collision.action.destination.slot = 4;
  code(classifyCommand(recorded.value, context, collision), 'COMMAND_ID_COLLISION');
});

test('S03-REC-34: openingMulligan is one exact no-input action with stable retry semantics', () => {
  const command = baseCommand({ action: { type: 'openingMulligan' } });
  const output = canonicalizeCommand(command);
  assert.equal(output.ok, true);
  assert.deepEqual(output.value.command.action, { type: 'openingMulligan' });
  assert.equal(output.value.canonicalPayload,
    '{"action":{"type":"openingMulligan"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}');
  for (const action of [
    { type: 'openingMulligan', cardRef: `r:${'1'.repeat(32)}` },
    { type: 'openingMulligan', count: 1 },
    { type: 'openingMulligan', force: true }
  ]) code(canonicalizeCommand(baseCommand({ action })), 'INVALID_COMMAND');
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  assert.equal(classifyCommand(recorded.value, context, command).value.kind, 'retry');
  const collision = structuredClone(command);
  collision.expectedRevision = 1;
  code(classifyCommand(recorded.value, context, collision), 'COMMAND_ID_COLLISION');
});

test('S03-REC-35: activateAbility accepts only the exact user Turbo action and retains v1 retry semantics', () => {
  const command = activateTurboCommand();
  const output = canonicalizeCommand(command);
  assert.equal(output.ok, true);
  assert.deepEqual(output.value.command.action, { type: 'activateAbility', ability: { kind: 'user', key: 'turbo' } });
  assert.equal(output.value.canonicalPayload,
    '{"action":{"ability":{"key":"turbo","kind":"user"},"type":"activateAbility"},"actorSeat":"seat-a","commandId":"command-a","contractVersion":1,"expectedRevision":0,"matchId":"match-a"}');
  for (const action of [
    { type: 'activateAbility' },
    { type: 'activateAbility', ability: { kind: 'player', key: 'turbo' } },
    { type: 'activateAbility', ability: { kind: 'user', key: 'watching_you' } },
    { type: 'activateAbility', ability: { kind: 'user', key: 'turbo', extra: true } },
    { type: 'activateAbility', ability: { kind: 'user', key: 'turbo' }, free: true }
  ]) {
    const result = canonicalizeCommand(activateTurboCommand({ action }));
    code(result, action.ability && typeof action.ability.kind === 'string' && action.ability.kind.length > 0
      && typeof action.ability.key === 'string' && action.ability.key.length > 0
      && (action.ability.kind !== 'user' || action.ability.key !== 'turbo')
      ? 'ACTION_SCHEMA_UNAVAILABLE' : 'INVALID_COMMAND');
  }
  const recorded = recordTerminal(newJournal(), context, command, rejected);
  assert.equal(recorded.ok, true);
  assert.equal(classifyCommand(recorded.value, context, command).value.kind, 'retry');
  assert.deepEqual(recordTerminal(recorded.value, context, command, rejected),
    { ok: false, error: { code: 'COMMAND_ALREADY_RECORDED' } });
});
