// One online room: who is in it, the decks, the match, and what happens when someone drops
// (design: サーバー設計-詳細.md §4-§8). It owns no clock, storage, randomness, socket or game:
// the host hands them in, so a Durable Object, a Node server or a test drives the same code.
//
//   clock    { now() }                          milliseconds since the epoch
//   store    { get(key), put(key, value), delete(key), deleteAll(), list(prefix) }   synchronous, JSON values
//            list returns the values whose key starts with prefix, in key order
//   random   { bytes(n) }                       Uint8Array of n random bytes
//   send     (connId, text) => void             one text frame to a connection
//   close    (connId, code, reason) => void
//   schedule (atMs | null) => void              wake alarm(); called whenever the next deadline changes
//   engine   the match, see runtime-engine.js for the real one
//   checkDeck(readyMessage) => { ok, value | error }         see deck-check.js
//   hashToken(token) => string | Promise<string>              default SHA-256 hex
//   onFinish ({ outcome, record, ... }) => void               optional: the match is over
//   onAuthenticated (connId, tokenHash) => void               optional: a socket said hello (a Durable Object keeps the hash in the socket)
//
// Host calls: init (a new room), connect / receive / disconnect (per socket), restore (a socket the host still holds
// after its memory was cleared), alarm (the time given to schedule has come), startup (the whole process restarted).
//
// Every public method is queued, so two messages never interleave between awaits.
import { CLOSE, LIMITS, encodeServerMessage, parseClientMessage, sanitizeGuestName } from './protocol.js';
import { sha256Hex } from './room-code.js';

const ROOM = 'room';
const AUTHORITY = 'authority';
const COMMAND = 'cmd:';
const commandKey = revision => `${COMMAND}${String(revision).padStart(8, '0')}`;
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function createRoomCore(deps) {
  const { clock, store, random, send, close, engine, checkDeck } = deps;
  const schedule = deps.schedule ?? (() => {});
  const hashToken = deps.hashToken ?? sha256Hex;
  const now = () => clock.now();

  let room = null;
  let loaded = false;
  let authority = null;
  const conns = new Map();
  let queue = Promise.resolve();
  const serial = work => {
    const run = queue.then(work, work);
    queue = run.then(() => {}, () => {});
    return run;
  };

  // ---- small helpers ------------------------------------------------------
  const emit = (connId, message) => { try { send(connId, encodeServerMessage(message)); } catch { /* the socket is already gone */ } };
  const hangUp = (connId, code, reason) => {
    conns.delete(connId);
    try { close(connId, code, reason); } catch { /* already closed */ }
  };
  const load = () => {
    if (loaded) return;
    room = store.get(ROOM) ?? null;
    loaded = true;
  };
  const saveRoom = () => store.put(ROOM, room);
  const seatIdOf = slot => room.game ? room.game.seatIds[room.order.indexOf(slot)] : null;
  const slotOfSeat = seatId => room.order[room.game.seatIds.indexOf(seatId)];
  const connOf = slot => {
    for (const [connId, conn] of conns) if (conn.hash && conn.hash === room.seats[slot]?.hash) return connId;
    return null;
  };
  const slotOfConn = conn => room.seats.findIndex(seat => seat.hash === conn.hash);
  const getAuthority = () => {
    if (authority) return authority;
    const text = store.get(AUTHORITY);
    const restored = text === undefined ? null : engine.restore(text);
    authority = restored?.ok ? restored.value : null;
    return authority;
  };
  const commandRows = () => store.list(COMMAND);

  const graceLeft = seat => seat.disconnectedAt === null ? null : Math.max(0, seat.disconnectedAt + LIMITS.graceMs - now());
  const opponentOf = slot => {
    const other = room.seats[1 - slot];
    return other ? { name: other.name, connected: connOf(1 - slot) !== null, ready: other.ready,
      userId: other.ready ? other.userId : null, graceMs: room.phase === 'playing' ? graceLeft(other) : null } : null;
  };
  const youOf = slot => ({ slot, name: room.seats[slot].name, ready: room.seats[slot].ready, seat: seatIdOf(slot) });
  const phaseDeadline = () => {
    if (!room) return null;
    const limit = room.createdAt + LIMITS.maxRoomAgeMs;
    if (room.phase === 'waiting') return Math.min(limit, room.createdAt + LIMITS.waitingMs);
    if (room.phase === 'lobby') return Math.min(limit, room.activityAt + LIMITS.lobbyIdleMs);
    if (room.phase === 'finished') return room.finishedAt + LIMITS.finishedKeepMs;
    return limit;
  };
  const deadline = () => {
    if (!room) return null;
    const times = [phaseDeadline()];
    for (const conn of conns.values()) if (conn.helloBy !== null && conn.helloBy !== undefined) times.push(conn.helloBy);
    if (room.phase === 'playing') {
      // One guest away: that guest's 60 seconds. Both away: nobody loses, so the match ends when the later 60 seconds are up.
      // Waking only for a moment that changes something keeps the alarm from having to set the next one from inside its own handler.
      const away = room.seats.filter(seat => seat.disconnectedAt !== null).map(seat => seat.disconnectedAt + LIMITS.graceMs);
      if (away.length === room.seats.length && away.length > 0) times.push(Math.max(...away));
      else if (away.length === 1) times.push(away[0]);
    }
    return Math.min(...times);
  };
  const reschedule = () => { try { schedule(room ? deadline() : null); } catch { /* the host retries on its next event */ } };

  // ---- per-connection rate limit -------------------------------------------
  const takeToken = conn => {
    const at = now();
    conn.tokens = Math.min(LIMITS.rateBurst, conn.tokens + (at - conn.at) / 1000 * LIMITS.ratePerSecond);
    conn.at = at;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  };

  // ---- sending the room's state -------------------------------------------
  const lobbyFor = slot => ({ t: 'lobby', phase: room.phase, you: youOf(slot), opponent: opponentOf(slot),
    expiresInMs: Math.max(0, phaseDeadline() - now()) });
  const broadcastLobby = () => {
    room.seats.forEach((_, slot) => { const connId = connOf(slot); if (connId) emit(connId, lobbyFor(slot)); });
  };
  const sendState = (slot, events) => {
    const connId = connOf(slot);
    if (!connId || !room.game) return;
    const view = engine.view(getAuthority(), seatIdOf(slot));
    if (!view.ok) { emit(connId, { t: 'error', code: 'ENGINE_ERROR' }); return; }
    emit(connId, { t: 'state', revision: view.value.status.revision, ...view.value, events });
  };
  const peerNotice = slot => {
    const connId = connOf(1 - slot);
    if (connId) emit(connId, { t: 'peer', connected: connOf(slot) !== null, graceMs: graceLeft(room.seats[slot]) });
  };
  const recordNow = () => {
    const rows = commandRows();
    const record = engine.record({ game: room.game, commands: rows, authority: getAuthority() });
    return record.ok ? record.value : null;
  };
  const endFor = slot => {
    const outcome = room.outcome;
    const perspective = outcome.kind === 'win' ? outcome.winnerSlot === slot ? 'win' : 'lose' : outcome.kind;
    return { t: 'end', outcome: perspective, reason: outcome.reason, record: room.game ? recordNow() : null };
  };

  // ---- ending --------------------------------------------------------------
  function finish(outcome, reason) {
    room.phase = 'finished';
    room.finishedAt = now();
    room.outcome = { ...outcome, reason };
    try { saveRoom(); } catch { /* the players still get the result */ }
    room.seats.forEach((_, slot) => { const connId = connOf(slot); if (connId) emit(connId, endFor(slot)); });
    try { deps.onFinish?.({ outcome: room.outcome, game: room.game, record: room.game ? recordNow() : null, code: room.code }); } catch { /* logging must not break the room */ }
    reschedule();
  }
  const winnerOf = outcome => outcome.kind === 'win' ? { kind: 'win', winnerSlot: slotOfSeat(outcome.winnerSeat) } : { kind: outcome.kind };
  function abort(reason) { finish({ kind: 'aborted' }, reason); }

  // A forfeit goes through the engine when it has one (then the runtime result is final);
  // until then the room itself records the other side as the winner.
  function forfeit(slot, reason, commandId) {
    const auth = getAuthority();
    const seatId = seatIdOf(slot);
    const winnerSlot = 1 - slot;
    let outcome = { kind: 'win', winnerSlot };
    const result = auth ? engine.forfeit?.(auth, seatId, { reason, commandId }) : null;
    if (result?.ok) {
      try {
        const row = result.row ?? { seat: seatId, system: 'forfeit', reason };
        store.put(AUTHORITY, engine.serialize(result.authority));
        store.put(commandKey(result.revision), row);
        authority = result.authority;
        const decided = engine.outcome(authority);
        if (decided) outcome = winnerOf(decided);
        room.seats.forEach((_, other) => sendState(other, result.eventsFor?.(seatIdOf(other)) ?? []));
      } catch { /* fall back to the room's own result */ }
    }
    finish(outcome, reason);
  }

  function closeRoom(reason) {
    for (const connId of [...conns.keys()]) {
      emit(connId, { t: 'error', code: 'ROOM_CLOSED', detail: reason });
      hangUp(connId, CLOSE.roomClosed, reason);
    }
    try { store.deleteAll(); } catch { /* the next alarm tries again */ }
    room = null;
    authority = null;
    reschedule();
  }

  // ---- starting ------------------------------------------------------------
  function startMatch() {
    const flip = random.bytes(1)[0] & 1;
    const order = flip ? [1, 0] : [0, 1];
    const seatIds = [`seat-${hex(random.bytes(4))}`, `seat-${hex(random.bytes(4))}`];
    if (seatIds[0] === seatIds[1]) seatIds[1] = `${seatIds[1]}x`;
    const matchId = `ol-${now().toString(36)}-${hex(random.bytes(6))}`;
    const seed = new DataView(random.bytes(4).buffer).getUint32(0);
    const players = order.map(slot => ({ userId: room.seats[slot].userId, ...room.seats[slot].deck }));
    let started;
    try { started = engine.start({ matchId, seatIds, seed, players }); } catch { started = { ok: false }; }
    if (!started.ok) {
      room.seats.forEach(seat => { seat.ready = false; });
      saveRoom();
      room.seats.forEach((_, slot) => { const connId = connOf(slot); if (connId) emit(connId, { t: 'error', code: 'ENGINE_ERROR' }); });
      broadcastLobby();
      return;
    }
    store.put(AUTHORITY, engine.serialize(started.authority));
    authority = started.authority;
    room.game = started.game;
    room.order = order;
    room.phase = 'playing';
    room.activityAt = now();
    saveRoom();
    room.seats.forEach((_, slot) => {
      const connId = connOf(slot);
      if (!connId) return;
      emit(connId, { t: 'start', matchId, you: youOf(slot), opponent: opponentOf(slot) });
      sendState(slot, []);
    });
    reschedule();
  }

  // ---- messages ------------------------------------------------------------
  async function hello(connId, conn, message) {
    if (conn.hash) { emit(connId, { t: 'error', code: 'ALREADY_HELLO' }); return; }
    const hash = await hashToken(message.token);
    let slot = room.seats.findIndex(seat => seat.hash === hash);
    if (slot < 0) {
      if ((room.phase !== 'waiting' && room.phase !== 'lobby') || room.seats.length >= 2) {
        emit(connId, { t: 'error', code: 'ROOM_FULL' });
        hangUp(connId, CLOSE.roomFull, 'room full');
        return;
      }
      room.seats.push({ hash, name: sanitizeGuestName(message.name), ready: false, userId: null, deck: null, disconnectedAt: null });
      slot = room.seats.length - 1;
      if (room.seats.length === 2) room.phase = 'lobby';
      room.activityAt = now();
    } else {
      for (const [otherId, other] of [...conns]) {
        if (otherId !== connId && other.hash === hash) hangUp(otherId, CLOSE.replaced, 'replaced');
      }
      room.seats[slot].disconnectedAt = null;
    }
    conn.hash = hash;
    conn.helloBy = null;
    try { deps.onAuthenticated?.(connId, hash); } catch { /* the host keeps its own record */ }
    saveRoom();
    emit(connId, { ...lobbyFor(slot), t: 'welcome' });
    if (room.phase === 'playing') {
      const events = message.haveRevision === undefined && engine.history
        ? engine.history({ game: room.game, commands: commandRows() }, seatIdOf(slot)) : [];
      sendState(slot, events);
      peerNotice(slot);
    } else if (room.phase === 'finished') {
      emit(connId, endFor(slot));
    } else {
      broadcastLobby();
    }
    reschedule();
  }

  function ready(slot, message) {
    if (room.phase !== 'waiting' && room.phase !== 'lobby') return { code: 'WRONG_PHASE' };
    const checked = checkDeck({ userId: message.userId, deck: message.deck });
    if (!checked.ok) return { code: 'DECK_INVALID', detail: checked.error };
    Object.assign(room.seats[slot], { ready: true, userId: checked.value.userId,
      deck: { deckId: checked.value.deckId, recipe: checked.value.recipe } });
    room.activityAt = now();
    saveRoom();
    broadcastLobby();
    if (room.phase === 'lobby' && room.seats.every(seat => seat.ready)) startMatch();
    reschedule();
    return null;
  }

  function command(connId, slot, message) {
    if (room.phase !== 'playing') { emit(connId, { t: 'error', code: 'NOT_PLAYING', commandId: message.commandId }); return; }
    const before = getAuthority();
    if (!before) { abortOnStorage(); return; }
    const seatId = seatIdOf(slot);
    let result;
    try { result = engine.submit(before, seatId, { commandId: message.commandId, expectedRevision: message.expectedRevision, action: message.action }); }
    catch { emit(connId, { t: 'error', code: 'ENGINE_ERROR', commandId: message.commandId }); return; }
    if (!result.ok) { emit(connId, { t: 'error', code: result.error.code, commandId: message.commandId }); return; }
    try {
      // Even a rejection changes the authority (the journal remembers the command id), so save whenever it differs.
      if (result.authority !== before) store.put(AUTHORITY, engine.serialize(result.authority));
      if (result.kind === 'accepted') {
        const row = engine.encodeCommand(before, seatId, message.action);
        store.put(commandKey(result.receipt.revision), row.ok ? row.value : { seat: seatId, unrecorded: true });
      }
    } catch {
      emit(connId, { t: 'error', code: 'STORAGE_UNAVAILABLE', commandId: message.commandId });
      abortOnStorage();
      return;
    }
    authority = result.authority;
    emit(connId, { t: 'ack', commandId: message.commandId, kind: result.kind, receipt: result.receipt });
    if (result.kind === 'accepted') {
      room.activityAt = now();
      room.seats.forEach((_, other) => sendState(other, result.eventsFor?.(seatIdOf(other)) ?? []));
      const decided = engine.outcome(authority);
      if (decided) finish(winnerOf(decided), 'normal');
    } else if (result.kind === 'retry') {
      sendState(slot, []);
    }
  }

  function abortOnStorage() {
    room.seats.forEach((_, slot) => { const connId = connOf(slot); if (connId) emit(connId, { t: 'error', code: 'STORAGE_UNAVAILABLE' }); });
    abort('storage');
  }

  function leave(connId, conn, slot) {
    if (room.phase === 'waiting' || room.phase === 'lobby') {
      room.seats.splice(slot, 1);
      if (room.seats.length === 0) { hangUp(connId, 1000, 'bye'); closeRoom('left'); return; }
      room.phase = 'waiting';
      room.seats.forEach(seat => { seat.ready = false; });
      saveRoom();
      hangUp(connId, 1000, 'bye');
      broadcastLobby();
      reschedule();
      return;
    }
    hangUp(connId, 1000, 'bye');
    dropped(conn, slot);
  }

  // The seat has no connection left.
  function dropped(conn, slot) {
    if (!room || slot < 0 || connOf(slot) !== null) return;
    if (room.phase === 'playing') {
      room.seats[slot].disconnectedAt = now();
      try { saveRoom(); } catch { /* the in-memory deadline still holds until the next wake */ }
      peerNotice(slot);
    } else if (room.phase === 'waiting' || room.phase === 'lobby') {
      broadcastLobby();
    }
    reschedule();
  }

  async function dispatch(connId, conn, message) {
    const slot = slotOfConn(conn);
    if (slot < 0) { hangUp(connId, CLOSE.roomClosed, 'no seat'); return; }
    switch (message.t) {
      case 'ready': {
        const problem = ready(slot, message);
        if (problem) emit(connId, { t: 'error', ...problem });
        return;
      }
      case 'unready':
        if (room.phase !== 'waiting' && room.phase !== 'lobby') { emit(connId, { t: 'error', code: 'WRONG_PHASE' }); return; }
        room.seats[slot].ready = false;
        saveRoom();
        broadcastLobby();
        return;
      case 'cmd': command(connId, slot, message); return;
      case 'plan':
      case 'inspect': {
        if (room.phase !== 'playing' || !getAuthority()) { emit(connId, { t: 'error', code: 'NOT_PLAYING', rid: message.rid }); return; }
        const seatId = seatIdOf(slot);
        const result = message.t === 'plan'
          ? engine.plan(getAuthority(), seatId, { expectedRevision: message.expectedRevision, actionId: message.actionId, selections: message.selections })
          : engine.inspect(getAuthority(), seatId, message.ref);
        emit(connId, { t: message.t === 'plan' ? 'planResult' : 'inspectResult', rid: message.rid,
          ...(result.ok ? { result: result.value } : { error: result.error }) });
        return;
      }
      case 'concede':
        if (room.phase !== 'playing') { emit(connId, { t: 'error', code: 'NOT_PLAYING', commandId: message.commandId }); return; }
        forfeit(slot, 'concede', message.commandId);
        return;
      case 'resync':
        if (room.phase === 'playing') sendState(slot, message.haveRevision === undefined && engine.history
          ? engine.history({ game: room.game, commands: commandRows() }, seatIdOf(slot)) : []);
        else if (room.phase === 'finished') emit(connId, endFor(slot));
        else emit(connId, lobbyFor(slot));
        return;
      case 'bye': leave(connId, conn, slot); return;
      default: emit(connId, { t: 'error', code: 'BAD_MESSAGE' });
    }
  }

  // ---- the host's entry points ----------------------------------------------
  return Object.freeze({
    // A new room, made once by the Worker that handed out the code.
    init: ({ code }) => serial(() => {
      load();
      if (room) return { ok: false, error: { code: 'ROOM_EXISTS' } };
      room = { v: 1, code, phase: 'waiting', createdAt: now(), activityAt: now(), seats: [], game: null, order: null, outcome: null, finishedAt: null };
      saveRoom();
      reschedule();
      return { ok: true };
    }),

    connect: connId => serial(() => {
      load();
      if (!room) { emit(connId, { t: 'error', code: 'ROOM_NOT_FOUND' }); try { close(connId, CLOSE.roomClosed, 'no room'); } catch { /* gone */ } return; }
      // A connection must say hello within a few seconds; the alarm (not a timer) closes the ones that do not.
      conns.set(connId, { hash: null, tokens: LIMITS.rateBurst, at: now(), strikes: 0, helloBy: now() + LIMITS.helloMs });
      reschedule();
    }),

    // After the host's memory was cleared (hibernation) a socket that already said hello is registered again.
    restore: (connId, hash) => serial(() => {
      load();
      if (!room) return;
      conns.set(connId, { hash, tokens: LIMITS.rateBurst, at: now(), strikes: 0, helloBy: null });
    }),

    receive: (connId, raw) => serial(async () => {
      load();
      const conn = conns.get(connId);
      if (!conn) return;
      if (!room) { emit(connId, { t: 'error', code: 'ROOM_CLOSED' }); hangUp(connId, CLOSE.roomClosed, 'closed'); return; }
      if (!takeToken(conn)) {
        emit(connId, { t: 'error', code: 'RATE_LIMITED' });
        conn.strikes += 1;
        if (conn.strikes >= 3) hangUp(connId, CLOSE.rateLimited, 'rate limited');
        return;
      }
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        emit(connId, { t: 'error', code: parsed.error.code });
        if (parsed.error.code === 'MESSAGE_TOO_LARGE') hangUp(connId, CLOSE.tooLarge, 'too large');
        else if (!conn.hash) hangUp(connId, CLOSE.helloRequired, 'hello first');
        return;
      }
      if (parsed.value.t === 'hello') { await hello(connId, conn, parsed.value); return; }
      if (!conn.hash) { emit(connId, { t: 'error', code: 'HELLO_REQUIRED' }); hangUp(connId, CLOSE.helloRequired, 'hello first'); return; }
      await dispatch(connId, conn, parsed.value);
    }),

    disconnect: connId => serial(() => {
      load();
      const conn = conns.get(connId);
      if (!conn) return;
      conns.delete(connId);
      if (room && conn.hash) dropped(conn, slotOfConn(conn));
      else reschedule();
    }),

    // Called by the host when the time given to schedule() has come.
    alarm: () => serial(() => {
      load();
      if (!room) return;
      const at = now();
      for (const [connId, conn] of [...conns]) if (!conn.hash && conn.helloBy !== null && at >= conn.helloBy) hangUp(connId, CLOSE.helloTimeout, 'hello timeout');
      if (room.phase === 'finished') { if (at >= room.finishedAt + LIMITS.finishedKeepMs) closeRoom('finished'); else reschedule(); return; }
      if (at >= room.createdAt + LIMITS.maxRoomAgeMs) {
        if (room.phase === 'playing') abort('max-age'); else closeRoom('expired');
        return;
      }
      if (room.phase === 'waiting' && at >= room.createdAt + LIMITS.waitingMs) { closeRoom('expired'); return; }
      if (room.phase === 'lobby' && at >= room.activityAt + LIMITS.lobbyIdleMs) { closeRoom('expired'); return; }
      if (room.phase === 'playing') {
        const gone = room.seats.map((seat, slot) => seat.disconnectedAt !== null && at >= seat.disconnectedAt + LIMITS.graceMs ? slot : -1).filter(slot => slot >= 0);
        if (gone.length === 2) abort('both-disconnected');
        else if (gone.length === 1 && room.seats[1 - gone[0]].disconnectedAt === null) forfeit(gone[0], 'disconnect');
      }
      reschedule();
    }),

    // For a host whose process (re)started, after it has registered the sockets it still holds (restore).
    // A seat that was thought connected but has no socket now starts its 60 seconds; a seat already counting keeps its deadline.
    // renew: true is for a host that lost every socket, such as a Node server: every seat without a socket starts over.
    startup: ({ renew = false } = {}) => serial(() => {
      load();
      if (!room || room.phase !== 'playing') return;
      room.seats.forEach((seat, slot) => { if (connOf(slot) === null && (renew || seat.disconnectedAt === null)) seat.disconnectedAt = now(); });
      try { saveRoom(); } catch { /* the deadline still holds in memory */ }
      reschedule();
    }),

    deadline: () => { load(); return deadline(); },
    snapshot: () => { load(); return room ? JSON.parse(JSON.stringify(room)) : null; }
  });
}
