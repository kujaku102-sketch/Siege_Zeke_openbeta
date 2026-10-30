import { canonicalCommand } from './canonical.js';
import { CommandRecordError, copyData, dense, exact, nonempty, ordinary, own, reject, revision, seatList } from './guards.js';

export const JOURNAL_VERSION = 1;
const CONTEXT_KEYS = ['matchId', 'actorSeat'];
const JOURNAL_KEYS = ['schemaVersion', 'matchId', 'seatIds', 'entries'];
const ENTRY_KEYS = ['commandId', 'actorSeat', 'canonicalPayload', 'receipt'];
const RECEIPT_KEYS = ['matchId', 'commandId', 'status', 'revision', 'reasonCode'];
const TERMINAL_KEYS = ['status', 'revision', 'reasonCode'];
const REJECTION_REASONS = ['UNSUPPORTED_ACTION', 'STALE_REVISION', 'ACTION_NOT_ALLOWED', 'REVISION_EXHAUSTED'];

export function journalData(input) {
  const journal = exact(input, JOURNAL_KEYS, 'INVALID_JOURNAL');
  if (journal.schemaVersion !== JOURNAL_VERSION || !nonempty(journal.matchId)) reject('INVALID_JOURNAL');
  journal.seatIds = seatList(journal.seatIds, 'INVALID_JOURNAL');
  const entries = dense(journal.entries, 'INVALID_JOURNAL');
  const seen = new Set();
  journal.entries = entries.map(entryValue => {
    const entry = exact(entryValue, ENTRY_KEYS, 'INVALID_JOURNAL');
    if (!nonempty(entry.commandId) || !nonempty(entry.actorSeat) || !journal.seatIds.includes(entry.actorSeat)
      || typeof entry.canonicalPayload !== 'string' || seen.has(entry.commandId)) reject('INVALID_JOURNAL');
    seen.add(entry.commandId);
    let parsed;
    try { parsed = JSON.parse(entry.canonicalPayload); } catch (error) {
      if (error instanceof SyntaxError) reject('INVALID_JOURNAL');
      throw error;
    }
    let canonical;
    try { canonical = canonicalCommand(parsed); } catch (error) {
      if (error instanceof CommandRecordError) reject('INVALID_JOURNAL');
      throw error;
    }
    if (canonical.canonicalPayload !== entry.canonicalPayload || canonical.command.commandId !== entry.commandId
      || canonical.command.actorSeat !== entry.actorSeat || canonical.command.matchId !== journal.matchId) reject('INVALID_JOURNAL');
    const receipt = exact(entry.receipt, RECEIPT_KEYS, 'INVALID_JOURNAL');
    if (receipt.matchId !== journal.matchId || receipt.commandId !== entry.commandId || !revision(receipt.revision)) reject('INVALID_JOURNAL');
    if (receipt.status === 'accepted') {
      if (receipt.reasonCode !== 'ACCEPTED' || canonical.command.expectedRevision === Number.MAX_SAFE_INTEGER
        || receipt.revision !== canonical.command.expectedRevision + 1) reject('INVALID_JOURNAL');
    } else if (receipt.status === 'rejected') {
      if (!REJECTION_REASONS.includes(receipt.reasonCode)) reject('INVALID_JOURNAL');
    } else reject('INVALID_JOURNAL');
    return entry;
  });
  return journal;
}

function authorizationHeader(journal, context, command) {
  const trusted = exact(context, CONTEXT_KEYS, 'NOT_AUTHORIZED');
  if (!nonempty(trusted.matchId) || !nonempty(trusted.actorSeat) || trusted.matchId !== command.matchId
    || trusted.actorSeat !== command.actorSeat) reject('NOT_AUTHORIZED');
  ordinary(journal, 'INVALID_JOURNAL');
  if (own(journal, 'schemaVersion', 'INVALID_JOURNAL') !== JOURNAL_VERSION) reject('INVALID_JOURNAL');
  const matchId = own(journal, 'matchId', 'INVALID_JOURNAL');
  const seatIds = seatList(own(journal, 'seatIds', 'INVALID_JOURNAL'), 'INVALID_JOURNAL');
  if (!nonempty(matchId)) reject('INVALID_JOURNAL');
  if (matchId !== command.matchId || !seatIds.includes(trusted.actorSeat)) reject('NOT_AUTHORIZED');
  return trusted;
}

export function classifyData(journalInput, contextInput, envelopeInput) {
  const canonical = canonicalCommand(envelopeInput);
  authorizationHeader(journalInput, contextInput, canonical.command);
  const journal = journalData(journalInput);
  if (journal.matchId !== canonical.command.matchId || !journal.seatIds.includes(canonical.command.actorSeat)) reject('NOT_AUTHORIZED');
  const existing = journal.entries.find(entry => entry.commandId === canonical.command.commandId);
  if (existing) {
    if (existing.actorSeat === canonical.command.actorSeat && existing.canonicalPayload === canonical.canonicalPayload) {
      return { kind: 'retry', receipt: copyData(existing.receipt, 'INVALID_JOURNAL') };
    }
    reject('COMMAND_ID_COLLISION');
  }
  return { kind: 'new', journal, command: canonical.command, canonicalPayload: canonical.canonicalPayload };
}

export function terminalData(input, command, matchId) {
  const terminal = exact(copyData(input, 'INVALID_TERMINAL'), TERMINAL_KEYS, 'INVALID_TERMINAL');
  if (!revision(terminal.revision) || !nonempty(terminal.status) || !nonempty(terminal.reasonCode)) reject('INVALID_TERMINAL');
  if (terminal.status === 'accepted') {
    if (terminal.reasonCode !== 'ACCEPTED') reject('INVALID_TERMINAL');
    if (command.expectedRevision === Number.MAX_SAFE_INTEGER) reject('REVISION_EXHAUSTED');
    if (terminal.revision !== command.expectedRevision + 1) reject('INVALID_TERMINAL');
  } else if (terminal.status === 'rejected') {
    if (!REJECTION_REASONS.includes(terminal.reasonCode)) reject('INVALID_TERMINAL');
  } else reject('INVALID_TERMINAL');
  return { matchId, commandId: command.commandId, ...terminal };
}
