import { createMatchAuthority } from './match-session-controller.js';
import { submitRuntimeCommand } from '../game/runtime/transaction.js';
import { makeBoundCommand } from './port-contract.js';
import { decodeRecordedAction, MATCH_RECORD_KIND, MATCH_RECORD_VERSION } from '../game/runtime/match-record.js';

const failure = (code, index = null) => ({ ok: false, error: { code, ...(index === null ? {} : { index }) } });

// Plays a match record from its start and returns the authority it ends in.
// Each command must be accepted again, or the record does not describe this build.
export function replayMatchRecord(record) {
  if (record?.kind !== MATCH_RECORD_KIND || record.schemaVersion !== MATCH_RECORD_VERSION) return failure('RECORD_UNSUPPORTED');
  const created = createMatchAuthority(structuredClone(record.game));
  if (!created.ok) return created;
  let authority = created.value;
  const tutorial = authority.metadata.startOptions.mode === 'tutorial';
  for (const [index, command] of record.commands.entries()) {
    const action = decodeRecordedAction(authority, command.seat, command.action);
    if (!action.ok) return failure(action.error.code, index);
    const { matchId, seatIds } = authority.metadata;
    const bound = makeBoundCommand({ contractVersion: 1, matchId, seatId: command.seat, seatIds: [...seatIds], sessionGeneration: 1 },
      { commandId: `replay:${index}`, expectedRevision: authority.revision, action: action.value });
    if (!bound.ok) return failure(bound.error.code, index);
    const result = submitRuntimeCommand(authority, { matchId, actorSeat: command.seat }, bound.value, { tutorialAuthorized: tutorial });
    if (!result.ok) return failure(result.error.code, index);
    if (result.value.kind !== 'accepted') return failure('RECORD_COMMAND_REJECTED', index);
    authority = result.value.authority;
  }
  return { ok: true, value: authority };
}
