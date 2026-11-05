// The page's side of an online room (design: サーバー設計-詳細.md §14): makes or joins a room, keeps the socket up,
// and turns what the room sends into one plain state a screen can read, plus the match session once a match runs.
//
//   const client = createOnlineClient({ endpoint, storage: localStorage });
//   client.subscribe(state => draw(state));
//   await client.createRoom({ name, ticket }); // or joinRoom(code, { name, ticket }); ticket: a Discord ticket (discord-login.js) or nothing
//   client.setReady({ userId, deck });      // deck: { kind: 'start', deckId } | { kind: 'custom', recipe }
//   client.session()                        // the remote session (remote-session.js) while a match is running or over
//
// Pure of the browser: the socket, fetch, storage, clock and timers are passed in, so Node tests drive it with fakes.
import { createRemoteSession } from './remote-session.js';
import { createReconnector } from './reconnect.js';
import { encodeClientMessage, LIMITS, parseServerMessage } from './protocol.js';
import { normalizeRoomCode, formatRoomCode } from './room-code.js';
import { roomSocketUrl, roomsUrl } from './endpoint.js';
import { TOKEN_KEY, guestToken } from './guest-token.js';
import { isDiscordAvatarUrl } from './discord-auth.js';

export { TOKEN_KEY };
export const NAME_KEY = 'sz-online-name';
const HEARTBEAT_MS = 30_000;
const DEAD_AFTER_MS = 70_000;

// Close codes after which trying again is pointless (src/network/protocol.js CLOSE).
const FINAL_CLOSE = new Map([[4003, 'ROOM_FULL'], [4004, 'ROOM_CLOSED'], [4009, 'REPLACED'], [4001, 'PROTOCOL'], [4002, 'PROTOCOL'], [1009, 'PROTOCOL']]);

// A seat as the room describes it, with the picture kept only if it is one of Discord's own addresses.
const seatOf = seat => seat && typeof seat === 'object' ? { ...seat, avatar: isDiscordAvatarUrl(seat.avatar) ? seat.avatar : null } : seat;

const blankState = () => ({
  status: 'idle', connection: 'none', attempt: 0, retryInMs: null,
  code: null, display: null, you: null, opponent: null, ticketStatus: null,
  opponentAwayUntil: null, selfAwayUntil: null, expiresAt: null,
  match: null, outcome: null, error: null
});

export function createOnlineClient({ endpoint, storage = null, createSocket = url => new globalThis.WebSocket(url),
  fetchImpl = (...args) => globalThis.fetch(...args), randomBytes = bytes => crypto.getRandomValues(new Uint8Array(bytes)),
  now = () => Date.now(), after = (ms, fn) => setTimeout(fn, ms), cancel = handle => clearTimeout(handle), random = Math.random }) {
  const token = guestToken(storage, randomBytes);
  let state = blankState();
  const listeners = new Set();
  let socket = null;
  let session = null;
  let guestName = 'ゲスト';
  let guestTicket = null;      // a Discord ticket (discord-login.js), shown to the room at hello when there is one
  let lastFrameAt = 0;
  let heartbeat = null;
  let intentional = false;     // leave() or dispose(): a close is then expected
  let welcomed = null;         // resolves the pending connection attempt
  let disposed = false;

  const publish = patch => {
    state = { ...state, ...patch };
    const snapshot = structuredClone(state);
    for (const listener of [...listeners]) { try { listener(snapshot); } catch { /* a screen's error is its own */ } }
  };
  const fail = (code, detail) => publish({ error: { code, ...(detail ? { detail } : {}) } });
  const send = message => {
    if (!socket || socket.readyState !== 1) return false;
    try { socket.send(encodeClientMessage(message)); return true; } catch { return false; }
  };

  // ---- the heartbeat: a literal "ping" the room answers without waking ------------------------
  const beat = () => {
    heartbeat = null;
    if (!socket || socket.readyState !== 1) return;
    if (now() - lastFrameAt > DEAD_AFTER_MS) { try { socket.close(); } catch { /* already going */ } return; }
    try { socket.send('ping'); } catch { /* the close handler takes over */ }
    heartbeat = after(HEARTBEAT_MS, beat);
  };
  const stopBeat = () => { if (heartbeat !== null) { cancel(heartbeat); heartbeat = null; } };

  // ---- what the room says ---------------------------------------------------------------------
  const lobbyPatch = frame => ({
    you: seatOf(frame.you) ?? state.you,
    opponent: seatOf(frame.opponent) ?? null,
    opponentAwayUntil: frame.opponent?.graceMs != null && frame.opponent.connected === false ? now() + frame.opponent.graceMs : null,
    expiresAt: Number.isFinite(frame.expiresInMs) ? now() + frame.expiresInMs : state.expiresAt
  });
  const statusOf = phase => phase === 'playing' ? 'playing' : phase === 'finished' ? 'finished' : 'lobby';

  function ensureSession(frame) {
    if (session || frame.t !== 'state' || !frame.status?.viewerSeat) return;
    const mine = frame.status.viewerSeat;
    const other = frame.status.seats?.find(seat => seat.seatId !== mine)?.seatId;
    if (!other) return;
    session = createRemoteSession({ matchId: frame.status.matchId, seat: mine, opponentSeat: other,
      transport: { send }, after, cancel });
    publish({ match: { matchId: frame.status.matchId } });
  }

  function onFrame(frame) {
    switch (frame.t) {
      case 'welcome':
        publish({ ...lobbyPatch(frame), status: statusOf(frame.phase), connection: 'open', selfAwayUntil: null, error: null, ticketStatus: frame.profile ?? null });
        welcomed?.(true);
        welcomed = null;
        return;
      case 'lobby':
        publish({ ...lobbyPatch(frame), status: state.status === 'playing' || state.status === 'finished' ? state.status : statusOf(frame.phase) });
        return;
      case 'start':
        publish({ status: 'playing', you: seatOf(frame.you) ?? state.you, opponent: seatOf(frame.opponent) ?? state.opponent, match: { matchId: frame.matchId } });
        return;
      case 'state':
        ensureSession(frame);
        session?.receive(frame);
        if (state.status === 'lobby') publish({ status: 'playing' });
        return;
      case 'peer':
        publish({ opponent: state.opponent ? { ...state.opponent, connected: Boolean(frame.connected) } : state.opponent,
          opponentAwayUntil: frame.connected === false && frame.graceMs != null ? now() + frame.graceMs : null });
        return;
      case 'end':
        session?.receive(frame);
        publish({ status: 'finished', outcome: { result: frame.outcome, reason: frame.reason }, opponentAwayUntil: null });
        return;
      case 'ack':
      case 'planResult':
      case 'inspectResult':
        session?.receive(frame);
        return;
      case 'error':
        if (frame.commandId !== undefined || frame.rid !== undefined) { session?.receive(frame); return; }
        fail(frame.code, frame.detail);
        if (frame.code === 'ROOM_FULL' || frame.code === 'ROOM_NOT_FOUND' || frame.code === 'ROOM_CLOSED') { welcomed?.(false); welcomed = null; }
        return;
      default:
    }
  }

  // ---- the socket -------------------------------------------------------------------------------
  const reconnector = createReconnector({
    connect: () => open(state.code),
    phase: () => state.status === 'playing' ? 'playing' : 'lobby',
    now, after, cancel, random,
    onStatus: status => {
      if (disposed) return;
      if (status.status === 'gave-up') publish({ connection: 'down', attempt: status.attempt, retryInMs: null, error: { code: 'CONNECTION_LOST' } });
      else if (status.status === 'connected') { session?.connectionRestored(); publish({ connection: 'open', attempt: 0, retryInMs: null, selfAwayUntil: null, error: null }); }
      else publish({ connection: 'reconnecting', attempt: status.attempt, retryInMs: status.retryInMs });
    }
  });

  // Opens a socket for the room and says hello; resolves true once the room has welcomed us.
  function open(code) {
    return new Promise(resolve => {
      let settled = false;
      const done = ok => { if (!settled) { settled = true; resolve(ok); } };
      let mine;
      try { mine = createSocket(roomSocketUrl(endpoint, code)); } catch { done(false); return; }
      socket = mine;
      welcomed = done;
      mine.addEventListener('open', () => {
        lastFrameAt = now();
        send({ t: 'hello', token, name: guestName, ...(guestTicket ? { ticket: guestTicket } : {}), ...(session && session.revision() >= 0 ? { haveRevision: session.revision() } : {}) });
        stopBeat();
        heartbeat = after(HEARTBEAT_MS, beat);
      });
      mine.addEventListener('message', event => {
        if (socket !== mine) return;
        lastFrameAt = now();
        if (typeof event.data !== 'string') return;
        const parsed = parseServerMessage(event.data);
        if (parsed.ok) onFrame(parsed.value);
      });
      mine.addEventListener('close', event => {
        if (socket !== mine) { done(false); return; }
        socket = null;
        stopBeat();
        done(false);
        onClosed(event?.code ?? 1006);
      });
      mine.addEventListener('error', () => { /* a close follows */ });
    });
  }

  function onClosed(code) {
    if (disposed || intentional) return;
    session?.connectionLost();
    const final = FINAL_CLOSE.get(code) ?? (code === 1008 ? 'RATE_LIMITED' : null);
    if (final) {
      reconnector.stop();
      publish({ connection: 'down', retryInMs: null, ...(state.error ? {} : { error: { code: final } }), ...(final === 'ROOM_FULL' || final === 'ROOM_CLOSED' || final === 'REPLACED' ? { status: state.status === 'finished' ? 'finished' : 'closed' } : {}) });
      return;
    }
    // Before the first welcome there is nothing to resume: enter() reports that failure.
    if (state.status !== 'lobby' && state.status !== 'playing') return;
    if (!reconnector.running()) {
      publish({ connection: 'reconnecting', selfAwayUntil: state.status === 'playing' ? now() + LIMITS.graceMs : null });
      reconnector.start();
    }
  }

  // The door answers a plain GET of the socket address with 404 for a code that is not valid and 426 (upgrade required) for one that is.
  async function whyNoSocket(code) {
    try {
      const probe = await fetchImpl(new URL(`/rooms/${encodeURIComponent(code)}/ws`, endpoint).toString());
      return probe.status === 404 ? 'ROOM_CODE_INVALID' : 'SERVER_UNREACHABLE';
    } catch { return 'SERVER_UNREACHABLE'; }
  }

  async function enter(code, { name, ticket } = {}) {
    guestTicket = typeof ticket === 'string' && ticket !== '' ? ticket : null;
    if (name) { guestName = name; try { storage?.setItem(NAME_KEY, name); } catch { /* kept for this page */ } }
    publish({ code, display: formatRoomCode(code), connection: 'connecting', error: null });
    const ok = await open(code);
    if (!ok) {
      // The socket never got a welcome. A refused upgrade shows only as a failed socket, so ask the door what it thinks of the code.
      if (!state.error) fail(await whyNoSocket(code));
      publish({ status: 'idle', connection: 'none' });
      return { ok: false, error: state.error };
    }
    return { ok: true, value: structuredClone(state) };
  }

  try { guestName = storage?.getItem(NAME_KEY) || guestName; } catch { /* default name */ }

  return Object.freeze({
    state: () => structuredClone(state),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    token: () => token,
    session: () => session,

    async createRoom(options = {}) {
      if (disposed || (state.status !== 'idle' && state.status !== 'closed')) return { ok: false, error: { code: 'WRONG_STATE' } };
      session?.dispose();
      session = null;
      publish({ ...blankState(), status: 'creating' });
      let response;
      try { response = await fetchImpl(roomsUrl(endpoint), { method: 'POST' }); }
      catch { fail('SERVER_UNREACHABLE'); publish({ status: 'idle' }); return { ok: false, error: state.error }; }
      if (response.status !== 201) {
        fail(response.status === 429 ? 'RATE_LIMITED' : response.status === 503 ? 'SERVER_BUSY' : response.status === 403 ? 'FORBIDDEN' : 'SERVER_UNREACHABLE');
        publish({ status: 'idle' });
        return { ok: false, error: state.error };
      }
      const made = await response.json();
      return enter(made.code, options);
    },

    async joinRoom(typed, options = {}) {
      if (disposed || (state.status !== 'idle' && state.status !== 'closed')) return { ok: false, error: { code: 'WRONG_STATE' } };
      const code = normalizeRoomCode(typed);
      session?.dispose();
      session = null;
      publish({ ...blankState(), status: 'joining' });
      if (!code) { fail('ROOM_CODE_INVALID'); publish({ status: 'idle' }); return { ok: false, error: state.error }; }
      return enter(code, options);
    },

    setReady: ({ userId, deck }) => send({ t: 'ready', userId, deck }),
    setUnready: () => send({ t: 'unready' }),
    concede: () => send({ t: 'concede', commandId: `x.${now().toString(36)}` }),

    // Leaves the room (before the match, the seat is freed) and goes back to idle.
    leave() {
      intentional = true;
      reconnector.stop();
      stopBeat();
      if (socket) { send({ t: 'bye' }); try { socket.close(1000); } catch { /* gone */ } socket = null; }
      session?.dispose();
      session = null;
      intentional = false;
      state = blankState();
      publish({});
    },

    dispose() {
      if (disposed) return;
      intentional = true;
      disposed = true;
      reconnector.stop();
      stopBeat();
      if (socket) { try { socket.close(1000); } catch { /* gone */ } socket = null; }
      session?.dispose();
      listeners.clear();
    }
  });
}
