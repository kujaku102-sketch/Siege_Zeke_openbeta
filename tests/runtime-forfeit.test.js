import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchAuthority } from '../src/game/runtime/authority.js';
import { validateLiveAuthority } from '../src/game/runtime/live-authority.js';
import { validateCommandJournal } from '../src/game/runtime/command-record.js';
import { submitRuntimeCommand, submitRuntimeSystemForfeit } from '../src/game/runtime/transaction.js';
import { projectRuntimeEventBatch } from '../src/game/runtime/event-feed.js';
import { runtimeProgress } from '../src/game/runtime/public-result.js';
import { buildRequiredInput } from '../src/game/runtime/required-input.js';
import { RULE_VERSION, CARD_VERSION } from '../src/game/runtime/versions.js';
import { createRuntimeCard } from '../src/game/runtime/factory.js';
import { placeCardInBoardSlot } from '../src/game/board-slots.js';
import { installCard, playCard } from '../src/game/engine.js';
import { buildRuntimeReferenceFrame } from '../src/game/runtime/reference-frame.js';
import { createRuntimeReferenceState, planRuntimeReferenceCreation } from '../src/game/runtime/references.js';
import { createRuntimeReferenceTokens } from '../src/game/runtime/reference-token.js';

const SEATS = ['seat-a', 'seat-b'];
const match = (mode = 'versus', extra = {}) => {
  const created = createMatchAuthority({ matchId: 'forfeit-match', seatIds: SEATS, seed: 11, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION,
    gameOptions: { mode, ...extra } });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
};
const concede = (authority, seat, commandId = `concede-${seat}`) => ({ contractVersion: 1, matchId: 'forfeit-match', commandId, actorSeat: seat,
  expectedRevision: authority.revision, action: { type: 'concede' } });
const submit = (authority, command) => submitRuntimeCommand(authority, { matchId: 'forfeit-match', actorSeat: command.actorSeat }, command);
const resultEvents = (before, after, command, receipt, viewer) => projectRuntimeEventBatch(before, after, command, receipt, viewer)
  .filter(event => event.type.startsWith('result_'));

// A match with an Sp half resolved: its text waits for a choice, so the Sp sits in no zone.
function spellInFlight() {
  const source = match('versus');
  const engine = source.engineState;
  engine.players.player.memory = 20;
  const give = (id, owner) => createRuntimeCard(engine.runtimeContext, id, owner);
  placeCardInBoardSlot(engine.players.player.front, give('STD-020', 'player'), { controllerId: 'player', zoneName: 'front', limit: engine.players.player.user.frontLimit, requestedSlot: 1 });
  placeCardInBoardSlot(engine.players.ai.front, give('STD-020', 'ai'), { controllerId: 'ai', zoneName: 'front', limit: engine.players.ai.user.frontLimit, requestedSlot: 1 });
  const symbol = give('STD-075', 'player'); // a red Ob in the registry gives the Sp its colour
  engine.players.player.hand.push(symbol);
  assert.equal(installCard(engine, 'player', symbol.uid), true);
  const spell = give('STD-086', 'player');
  engine.players.player.hand.push(spell);
  assert.equal(playCard(engine, 'player', spell.uid, { targetUid: engine.players.ai.front[0].uid }), true);
  assert.notEqual(engine.pending, null, 'the Sp waits for a choice');
  const frame = buildRuntimeReferenceFrame(engine);
  assert.equal(frame.ok, true, JSON.stringify(frame));
  const planned = planRuntimeReferenceCreation(frame.value);
  const tokens = createRuntimeReferenceTokens({ count: planned.value.newRefCount, issuedRefs: [] });
  const referenceState = createRuntimeReferenceState({ frame: frame.value, newRefs: tokens.value });
  assert.equal(referenceState.ok, true, JSON.stringify(referenceState));
  const rebuilt = { ...source, engineState: engine, referenceState: referenceState.value };
  assert.equal(validateLiveAuthority(rebuilt).ok, true, 'the match with the Sp in flight is a valid live match');
  return { spell, authority: rebuilt };
}

test('a concession ends the match at once, for either seat, even before the first turn', () => {
  for (const [conceding, winner] of [['seat-a', 'ai'], ['seat-b', 'player']]) {
    const before = match('versus', { openingProtocol: 'v2.4' });
    assert.ok(before.engineState.opening, 'the opening decisions are still open');
    const command = concede(before, conceding);
    const result = submit(before, command);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.kind, 'accepted');
    assert.equal(result.value.receipt.revision, before.revision + 1);
    const after = result.value.authority;
    assert.equal(after.engineState.winner, winner);
    assert.deepEqual(after.engineState.victory, { lockedOutcome: winner, lockedAtEffectId: null, finished: true, finishReason: 'concede' });
    assert.equal(runtimeProgress(after.engineState), 'finished');
    assert.equal(result.value.publicResult.receipt.progress, 'finished');
    assert.equal(validateLiveAuthority(after).ok, true);
    for (const seat of SEATS) {
      assert.equal(buildRequiredInput(after, seat).value, null, 'nothing is left to answer');
      const events = resultEvents(before, after, command, result.value.receipt, seat);
      assert.deepEqual(events.map(event => [event.type, event.outcome, event.reason]),
        [['result_finished', { kind: 'win', winnerSeat: winner === 'player' ? 'seat-a' : 'seat-b' }, 'concede']], 'one event, with the reason');
    }
    assert.equal(validateCommandJournal(after.journal).ok, true);
    assert.equal(after.journal.entries.at(-1).commandId, command.commandId);
  }
});

test('a concession repeats as the same receipt, and a finished match takes no other command', () => {
  const start = match();
  const command = concede(start, 'seat-a');
  const first = submit(start, command).value;
  const again = submit(first.authority, command);
  assert.equal(again.value.kind, 'retry');
  assert.deepEqual(again.value.receipt, first.receipt);
  const other = submit(first.authority, concede(first.authority, 'seat-b', 'other'));
  assert.equal(other.value.kind, 'rejected');
  assert.equal(other.value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
  const turn = submit(first.authority, { ...concede(first.authority, 'seat-a', 'turn'), action: { type: 'endTurn' } });
  assert.equal(turn.value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
});

test('a concession is refused in modes that have no result, and by a seat that is not in the match', () => {
  for (const mode of ['sandbox']) {
    const start = match(mode);
    assert.equal(submit(start, concede(start, 'seat-a')).value.receipt.reasonCode, 'ACTION_NOT_ALLOWED');
  }
  const start = match();
  assert.equal(submit(start, concede(start, 'stranger')).ok, false);
});

test('a concession ends a match with an effect still open: the open choice goes, the Sp goes to its owner trash', () => {
  const { spell, authority } = spellInFlight();
  assert.equal(authority.engineState.players.player.hand.some(card => card.uid === spell.uid), false, 'the Sp is in flight');
  const result = submit(authority, concede(authority, 'seat-b'));
  assert.equal(result.ok, true, JSON.stringify(result));
  const engine = result.value.authority.engineState;
  assert.equal(engine.pending, null);
  assert.equal(engine.effectResolution, null);
  assert.equal(engine.winner, 'player');
  assert.equal(engine.players.player.trash.some(card => card.uid === spell.uid), true);
  assert.equal(validateLiveAuthority(result.value.authority).ok, true);
});

test('a result an effect already locked stays when a concession ends the match', () => {
  const start = match();
  start.engineState.winner = 'player';
  start.engineState.victory = { lockedOutcome: 'player', lockedAtEffectId: null, finished: false };
  for (const seat of SEATS) {
    const result = submit(start, concede(start, seat));
    assert.equal(result.value.authority.engineState.winner, 'player');
    assert.equal(result.value.authority.engineState.victory.finished, true);
  }
});

test('the server forfeit is not a client command: the action and the system: command ids are refused and leave no trace', () => {
  const start = match();
  const refused = [
    { ...concede(start, 'seat-a', 'plain'), action: { type: 'systemForfeit', reason: 'disconnect' } },
    concede(start, 'seat-a', 'system:forfeit:1'),
    { ...concede(start, 'seat-a', 'system:anything'), action: { type: 'endTurn' } }
  ];
  for (const command of refused) {
    const result = submit(start, command);
    assert.equal(result.ok, false, command.commandId);
    assert.equal(result.error.code, 'NOT_AUTHORIZED');
  }
  assert.equal(start.journal.entries.length, 0);
  assert.equal(start.revision, 0);
});

test('systemForfeit loses the named seat, journals itself, and works with a choice open', () => {
  for (const authority of [match(), spellInFlight().authority]) {
    const result = submitRuntimeSystemForfeit(authority, { seat: 'seat-a', reason: 'disconnect' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const { value } = result;
    assert.equal(value.kind, 'accepted');
    assert.equal(value.receipt.revision, authority.revision + 1);
    assert.equal(value.authority.engineState.winner, 'ai');
    assert.equal(value.authority.engineState.victory.finishReason, 'disconnect');
    assert.equal(validateLiveAuthority(value.authority).ok, true);
    const entry = value.authority.journal.entries.at(-1);
    assert.equal(entry.commandId, value.command.commandId);
    assert.equal(entry.actorSeat, 'seat-a');
    assert.equal(validateCommandJournal(value.authority.journal).ok, true);
    for (const seat of SEATS) {
      const events = resultEvents(authority, value.authority, value.command, value.receipt, seat);
      assert.deepEqual(events.map(event => [event.type, event.reason]), [['result_finished', 'disconnect']]);
      assert.deepEqual(events[0].outcome, { kind: 'win', winnerSeat: 'seat-b' });
    }
    assert.equal(submitRuntimeSystemForfeit(value.authority, { seat: 'seat-b', reason: 'disconnect' }).error.code, 'ACTION_NOT_ALLOWED', 'once');
  }
});

test('systemForfeit refuses an unknown seat, an unknown reason and a mode without a result', () => {
  const start = match();
  assert.equal(submitRuntimeSystemForfeit(start, { seat: 'stranger', reason: 'disconnect' }).error.code, 'INVALID_COMMAND');
  assert.equal(submitRuntimeSystemForfeit(start, { seat: 'seat-a', reason: 'concede' }).error.code, 'INVALID_COMMAND');
  assert.equal(submitRuntimeSystemForfeit(match('sandbox'), { seat: 'seat-a', reason: 'disconnect' }).error.code, 'ACTION_NOT_ALLOWED');
});

test('a human-vs-human match is its own mode and takes the same opening as the CPU match', () => {
  for (const mode of ['ai', 'versus']) {
    const start = match(mode, { openingProtocol: 'v2.4' });
    assert.equal(start.engineState.mode, mode);
    assert.equal(start.engineState.phase, 'opening');
    assert.equal(validateLiveAuthority(start).ok, true);
  }
  assert.equal(createMatchAuthority({ matchId: 'm', seatIds: SEATS, seed: 1, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION,
    gameOptions: { mode: 'duel' } }).ok, false);
  assert.equal(createMatchAuthority({ matchId: 'm', seatIds: SEATS, seed: 1, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION,
    gameOptions: { mode: 'sandbox', openingProtocol: 'v2.4' } }).ok, false);
});
