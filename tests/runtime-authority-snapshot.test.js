import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from '../src/game/runtime/session.js';
import { buildRuntimeReferenceFrame } from '../src/game/runtime/reference-frame.js';
import { createRuntimeReferenceState } from '../src/game/runtime/references.js';
import { createCommandJournal } from '../src/game/runtime/command-record.js';
import { createRuntimeAuthoritySnapshot, restoreRuntimeAuthoritySnapshot } from '../src/game/runtime/authority-snapshot.js';
import { submitRuntimeCommand } from '../src/game/runtime/transaction.js';
import { createRuntimeCard } from '../src/game/runtime/factory.js';
import { buildRequiredInput } from '../src/game/runtime/required-input.js';

function authority({ playerUserId = 'bigboss', playerDeckRecipe = [['STD-001', 10]], aiDeckRecipe = [['STD-001', 10]] } = {}) {
  const session = createRuntimeSession({
    matchId: 'snapshot-command-match', seatIds: ['seat-a', 'seat-b'], seed: 41,
    ruleVersion: 'rules-1', cardVersion: 'cards-1',
    gameOptions: { mode: 'ai', playerUserId, playerDeckRecipe, aiDeckRecipe }
  });
  assert.equal(session.ok, true, JSON.stringify(session));
  const frame = buildRuntimeReferenceFrame(session.value.engineState);
  assert.equal(frame.ok, true, JSON.stringify(frame));
  const newRefCount = frame.value.cards.reduce((count, card) => {
    if (card.location.kind === 'board') return count + 2;
    if (card.location.kind === 'zone' && card.location.zone === 'hand') return count + 1;
    if (card.location.kind === 'zone' && ['registry', 'trash', 'ban'].includes(card.location.zone) && !card.faceDown) return count + 2;
    return count;
  }, 0);
  const references = createRuntimeReferenceState({
    frame: frame.value,
    newRefs: Array.from({ length: newRefCount }, (_, index) => `r:${(index + 1).toString(16).padStart(32, '0')}`)
  });
  assert.equal(references.ok, true, JSON.stringify(references));
  const journal = createCommandJournal({ matchId: 'snapshot-command-match', seatIds: ['seat-a', 'seat-b'] });
  assert.equal(journal.ok, true);
  return { ...session.value, referenceState: references.value, journal: journal.value };
}

const mulligan = {
  contractVersion: 1, matchId: 'snapshot-command-match', commandId: 'mulligan-1', actorSeat: 'seat-a', expectedRevision: 0,
  action: { type: 'openingMulligan' }
};
const context = { matchId: 'snapshot-command-match', actorSeat: 'seat-a' };
const expected = { matchId: 'snapshot-command-match', seatIds: ['seat-a', 'seat-b'], ruleVersion: 'rules-1', cardVersion: 'cards-1' };

test('S03-ASN-01: authority snapshot restores journal so an accepted command remains an exact retry', () => {
  const initial = authority();
  const initialSnapshot = createRuntimeAuthoritySnapshot(initial);
  assert.equal(initialSnapshot.ok, true, JSON.stringify(initialSnapshot));
  const accepted = submitRuntimeCommand(initial, context, mulligan);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.value.kind, 'accepted');
  const snapshot = createRuntimeAuthoritySnapshot(accepted.value.authority);
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  assert.equal(snapshot.value.format, 'siege-zeke.command-authority-snapshot');
  assert.equal(snapshot.value.journal.entries.length, 1);
  const restored = restoreRuntimeAuthoritySnapshot(structuredClone(snapshot.value), expected);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.value.revision, 1);
  assert.equal(restored.value.engineState.players.player.mulligansUsed, 1);
  const retry = submitRuntimeCommand(restored.value, context, mulligan);
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.value.kind, 'retry');
  assert.equal(retry.value.authority.journal.entries.length, 1);
  assert.deepEqual(retry.value.publicResult.events, []);
});

test('S03-ASN-02: missing or corrupt journal cannot be replaced by an empty dedup history', () => {
  const source = authority();
  const missing = { ...source };
  delete missing.journal;
  assert.deepEqual(createRuntimeAuthoritySnapshot(missing), {
    ok: false, error: { code: 'AUTHORITY_SNAPSHOT_INVALID_INPUT' }
  });
  const corrupt = { ...source, journal: { ...source.journal, entries: [{}] } };
  assert.deepEqual(createRuntimeAuthoritySnapshot(corrupt), { ok: false, error: { code: 'INVALID_JOURNAL' } });
  let reads = 0;
  const accessor = { ...source };
  Object.defineProperty(accessor, 'journal', { enumerable: true, get() { reads += 1; return source.journal; } });
  assert.deepEqual(createRuntimeAuthoritySnapshot(accessor), {
    ok: false, error: { code: 'AUTHORITY_SNAPSHOT_INVALID_INPUT' }
  });
  assert.equal(reads, 0);
});

test('S04-ASN-01: a supported plugin input roundtrips and remains answerable after restore', () => {
  const source = authority({ playerUserId: 'doors_zx', playerDeckRecipe: [], aiDeckRecipe: [] });
  const plugin = createRuntimeCard(source.engineState.runtimeContext, 'STD-224', 'player');
  source.engineState.players.player.hand.push(plugin);
  const frame = buildRuntimeReferenceFrame(source.engineState);
  assert.equal(frame.ok, true);
  const previous = new Set(source.referenceState.issuedRefs);
  const refsNeeded = frame.value.cards.reduce((count, card) => count
    + (card.location.kind === 'board' ? 2
      : card.location.kind === 'zone' && card.location.zone === 'hand' ? 1
        : card.location.kind === 'zone' && ['registry', 'trash', 'ban'].includes(card.location.zone) && !card.faceDown ? 2 : 0), 0);
  const refs = createRuntimeReferenceState({ frame: frame.value, newRefs: Array.from({ length: refsNeeded }, (_, index) => {
    let serial = index + 1000;
    let candidate = `r:${serial.toString(16).padStart(32, '0')}`;
    while (previous.has(candidate)) candidate = `r:${(++serial).toString(16).padStart(32, '0')}`;
    return candidate;
  }) });
  assert.equal(refs.ok, true);
  source.referenceState = refs.value;
  const cardRef = source.referenceState.entries.find(entry => entry.viewerSeat === 'seat-a'
    && entry.identity.instanceId === plugin.identity.instanceId)?.cardRef;
  assert.equal(typeof cardRef, 'string');
  const installed = submitRuntimeCommand(source, context, {
    contractVersion: 1, matchId: 'snapshot-command-match', commandId: 'install-plugin', actorSeat: 'seat-a', expectedRevision: 0,
    action: { type: 'install', cardRef }
  });
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(installed.value.authority.engineState.prompt?.type, 'plugin-number');
  const result = createRuntimeAuthoritySnapshot(installed.value.authority);
  assert.equal(result.ok, true, JSON.stringify(result));
  const restored = restoreRuntimeAuthoritySnapshot(structuredClone(result.value), expected);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.value.engineState.prompt?.type, 'plugin-number');
  const required = buildRequiredInput(restored.value, 'seat-a');
  assert.equal(required.ok, true, JSON.stringify(required));
  const answered = submitRuntimeCommand(restored.value, context, {
    contractVersion: 1, matchId: 'snapshot-command-match', commandId: 'answer-plugin', actorSeat: 'seat-a', expectedRevision: 1,
    action: {
      type: 'answerChoice', choiceId: required.value.choiceId,
      optionIds: [required.value.options[3].optionId], allocation: []
    }
  });
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.value.kind, 'accepted');
  assert.equal(answered.value.authority.engineState.players.player.registry.find(card => card.id === 'STD-224')?.pluginValue, 3);
});
