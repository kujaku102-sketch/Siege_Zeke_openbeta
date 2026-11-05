// The match behind a room: this repo's headless runtime, seen through the small interface room-core uses.
// Everything here is synchronous and returns { ok, ... }; no clock, no storage, no socket.
//
// Not yet usable inside a Worker: the runtime's own imports reach UI modules (design §2.2). In Node it runs as is.
// `forfeit` is left out on purpose until the runtime has a concede / system-forfeit entry (design §6);
// room-core then records the other side as the winner itself.
import { createMatchAuthority } from '../adapters/match-session-controller.js';
import { createLocalRuntimeCoordinator } from '../adapters/local-runtime-port.js';
import { makeBoundCommand } from '../adapters/port-contract.js';
import { submitRuntimeCommand } from '../game/runtime/transaction.js';
import { validateLiveAuthority } from '../game/runtime/live-authority.js';
import { projectRuntimeEventBatch } from '../game/runtime/event-feed.js';
import { decodeRecordedAction, encodeRecordedAction, MATCH_RECORD_KIND, MATCH_RECORD_VERSION, recordedCardDefinition,
  summarizeMatchRecord } from '../game/runtime/match-record.js';

const failure = (code, detail) => ({ ok: false, error: { code, ...(detail ? { detail } : {}) } });

export function createRuntimeEngine({ ruleVersion = '2.0-public-staging.11', cardVersion = 'beta0.9.1', openingProtocol = 'v2.4' } = {}) {
  // One coordinator per authority object; its ports (one per seat) answer every read for that authority.
  const readers = new WeakMap();
  const portOf = (authority, seatId) => {
    let reader = readers.get(authority);
    if (!reader) {
      const made = createLocalRuntimeCoordinator({ authority, sessionGeneration: 1 });
      if (!made.ok) return made;
      reader = { coordinator: made.value, ports: new Map() };
      readers.set(authority, reader);
    }
    if (!reader.ports.has(seatId)) {
      const bound = reader.coordinator.bind({ seatId });
      if (!bound.ok) return bound;
      reader.ports.set(seatId, bound.value);
    }
    return { ok: true, value: reader.ports.get(seatId) };
  };
  const bind = (authority, seatId, intent) => makeBoundCommand({
    contractVersion: 1, matchId: authority.metadata.matchId, seatId, seatIds: [...authority.metadata.seatIds], sessionGeneration: 1
  }, intent);

  const outcome = authority => {
    const victory = authority.engineState.victory;
    if (victory?.finished !== true) return null;
    if (victory.lockedOutcome === 'draw') return { kind: 'draw' };
    const index = victory.lockedOutcome === 'player' ? 0 : victory.lockedOutcome === 'ai' ? 1 : -1;
    return index < 0 ? null : { kind: 'win', winnerSeat: authority.metadata.seatIds[index] };
  };

  return Object.freeze({
    // players[i] plays seatIds[i]: { userId, deckId | null, recipe | null }
    start({ matchId, seatIds, seed, players }) {
      const [first, second] = players;
      const game = { matchId, seatIds: [...seatIds], seed, ruleVersion, cardVersion, gameOptions: {
        ...(openingProtocol === 'v2.4' ? { openingProtocol } : {}), mode: 'ai',
        playerDeckId: first.deckId ?? 'red', aiDeckId: second.deckId ?? 'yellow',
        playerDeckRecipe: first.recipe ?? null, aiDeckRecipe: second.recipe ?? null,
        playerUserId: first.userId, aiUserId: second.userId, sandboxDeckSetup: false } };
      const created = createMatchAuthority(structuredClone(game));
      return created.ok ? { ok: true, authority: created.value, game } : failure(created.error?.code ?? 'ENGINE_START_FAILED');
    },

    // -> { ok, kind: 'accepted' | 'rejected' | 'retry', receipt, authority, eventsFor(seatId) }
    submit(authority, seatId, intent) {
      const command = bind(authority, seatId, intent);
      if (!command.ok) return command;
      const result = submitRuntimeCommand(authority, { matchId: authority.metadata.matchId, actorSeat: seatId }, command.value, {});
      if (!result.ok) return result;
      const next = result.value.authority ?? authority;
      return { ok: true, kind: result.value.kind, receipt: result.value.receipt, authority: next,
        eventsFor: viewer => projectRuntimeEventBatch(authority, next, command.value, result.value.receipt, viewer) };
    },

    // What one seat may see: { status, observation, requiredInput, legalActions, actionBlocks }.
    view(authority, seatId) {
      const port = portOf(authority, seatId);
      if (!port.ok) return port;
      const read = port.value.query();
      if (!read.ok) return read;
      const { status, observation, requiredInput, legalActions, actionBlocks } = read.value;
      return { ok: true, value: { status, observation, requiredInput, legalActions, actionBlocks } };
    },

    plan(authority, seatId, input) {
      const port = portOf(authority, seatId);
      return port.ok ? port.value.queryAction(input) : port;
    },

    inspect(authority, seatId, ref) {
      const port = portOf(authority, seatId);
      if (!port.ok) return port;
      const read = port.value.query({ inspectRef: ref });
      return read.ok ? (read.value.inspection ? { ok: true, value: read.value.inspection } : failure('INSPECTION_NOT_ALLOWED')) : read;
    },

    outcome,

    serialize: authority => JSON.stringify(authority),
    restore(text) {
      try {
        const authority = JSON.parse(text);
        const checked = validateLiveAuthority(authority);
        return checked.ok ? { ok: true, value: authority } : failure('INVALID_LIVE_AUTHORITY');
      } catch { return failure('INVALID_LIVE_AUTHORITY'); }
    },

    // The row kept for a command that was accepted: card refs become instance ids so it can be played again.
    encodeCommand(before, seatId, action) {
      const encoded = encodeRecordedAction(before, seatId, action);
      if (!encoded.ok) return encoded;
      const card = recordedCardDefinition(before.engineState, encoded.value);
      return { ok: true, value: { seat: seatId, action: encoded.value, ...(card ? { card } : {}) } };
    },

    // The replay record of this match so far (same shape the local game keeps).
    record({ game, commands, authority }) {
      const record = { kind: MATCH_RECORD_KIND, schemaVersion: MATCH_RECORD_VERSION, game: structuredClone(game),
        commands: commands.filter(row => row.action) };
      return { ok: true, value: { ...record, summary: summarizeMatchRecord(record, authority, outcome(authority)) } };
    },

    // One seat's event feed from the start, rebuilt by playing the stored commands again.
    history({ game, commands }, seatId) {
      const created = createMatchAuthority(structuredClone(game));
      if (!created.ok) return [];
      let authority = created.value;
      const events = [];
      for (const row of commands) {
        if (!row.action) continue;
        const action = decodeRecordedAction(authority, row.seat, row.action);
        if (!action.ok) break;
        const command = bind(authority, row.seat, { commandId: `history:${events.length}:${authority.revision}`,
          expectedRevision: authority.revision, action: action.value });
        if (!command.ok) break;
        const result = submitRuntimeCommand(authority, { matchId: authority.metadata.matchId, actorSeat: row.seat }, command.value, {});
        if (!result.ok || result.value.kind !== 'accepted') break;
        events.push(...projectRuntimeEventBatch(authority, result.value.authority, command.value, result.value.receipt, seatId));
        authority = result.value.authority;
      }
      return events;
    }
  });
}
