import { canonicalCommand } from './command-record/canonical.js';
import { CommandRecordError, copyData, exact, nonempty, reject, seatList } from './command-record/guards.js';
import { JOURNAL_VERSION, classifyData, journalData, terminalData } from './command-record/journal.js';

function envelope(action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof CommandRecordError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function createCommandJournal(input) {
  return envelope(() => {
    const args = exact(copyData(input, 'INVALID_COMMAND'), ['matchId', 'seatIds'], 'INVALID_COMMAND');
    if (!nonempty(args.matchId)) reject('INVALID_COMMAND');
    return { schemaVersion: JOURNAL_VERSION, matchId: args.matchId, seatIds: seatList(args.seatIds, 'INVALID_COMMAND'), entries: [] };
  });
}

export function canonicalizeCommand(input) {
  return envelope(() => canonicalCommand(input));
}

export function validateCommandJournal(input) {
  return envelope(() => copyData(journalData(input), 'INVALID_JOURNAL'));
}

export function classifyCommand(journal, context, command) {
  return envelope(() => {
    const result = classifyData(journal, context, command);
    return result.kind === 'retry' ? { kind: 'retry', receipt: result.receipt } : { kind: 'new' };
  });
}

export function recordTerminal(journal, context, command, terminal) {
  return envelope(() => {
    const result = classifyData(journal, context, command);
    if (result.kind === 'retry') reject('COMMAND_ALREADY_RECORDED');
    const receipt = terminalData(terminal, result.command, result.journal.matchId);
    const next = copyData(result.journal, 'INVALID_JOURNAL');
    next.entries.push({
      commandId: result.command.commandId,
      actorSeat: result.command.actorSeat,
      canonicalPayload: result.canonicalPayload,
      receipt
    });
    return next;
  });
}
