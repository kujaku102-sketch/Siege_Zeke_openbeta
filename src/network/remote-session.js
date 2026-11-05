// The match as the page sees it when the other side is a room on a server (design: サーバー設計-詳細.md §14.2).
// It has the shape createMatchSessionController returns for a local match, so the page code that reads a session works on it:
//   - reads (query(), latest(), events(), receipt(), readStamp(), scope(), takeEvents()) answer at once from what the room last sent;
//   - writes (submit(), queryAction(), query({ inspectRef })) go to the room and return a Promise.
// It holds no socket. The caller (online-client.js) hands it every frame (receive), says when the socket dropped and
// came back (connectionLost / connectionRestored), and gives it a transport: { send(message) -> boolean }.
// Pure: no DOM, no timers of its own (the clock and the timer are passed in).
const failure = (code, detail) => ({ ok: false, error: { code, ...(detail ? { detail } : {}) } });
const clone = value => structuredClone(value);
const nonempty = value => typeof value === 'string' && value.length > 0;

const REPLY_MS = 15_000;

function intentOf(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 3 || keys.some(key => !['commandId', 'expectedRevision', 'action'].includes(key))) return null;
  const { commandId, expectedRevision, action } = input;
  if (!nonempty(commandId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || action === null || typeof action !== 'object' || typeof action.type !== 'string') return null;
  return { commandId, expectedRevision, action };
}

export function createRemoteSession({ matchId, seat, opponentSeat, transport, nonce = Math.random().toString(16).slice(2, 8),
  after = (ms, fn) => setTimeout(fn, ms), cancel = handle => clearTimeout(handle), replyMs = REPLY_MS }) {
  const seatIds = [seat, opponentSeat];
  let disposed = false;
  let cache = null;            // the last { status, observation, requiredInput, legalActions, actionBlocks }
  let revision = -1;
  let feed = [];               // this seat's events, oldest first
  const seen = new Set();
  const cursors = new Map();
  let record = null;
  let serial = 0;
  let resendOnState = false;
  const operations = new Map(); // client commandId -> { runtimeId, payload, intent, result, waiters }
  const byRuntimeId = new Map();
  const asks = new Map();       // rid -> { resolve, timer }
  const tracked = new Set();
  const listeners = new Set();
  const changed = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* a screen's error is its own */ } } };

  // ---- waiting for the room's answer --------------------------------------------
  const settle = (operation, result) => {
    operation.result = result;
    for (const waiter of operation.waiters.splice(0)) { cancel(waiter.timer); waiter.resolve(clone(result)); }
  };
  const wait = operation => new Promise(resolve => {
    const waiter = { resolve, timer: null };
    waiter.timer = after(replyMs, () => {
      const index = operation.waiters.indexOf(waiter);
      if (index >= 0) { operation.waiters.splice(index, 1); resolve(failure('REMOTE_TIMEOUT')); }
    });
    operation.waiters.push(waiter);
  });
  const ask = message => new Promise(resolve => {
    const rid = `q${nonce}${++serial}`;
    const entry = { resolve, timer: after(replyMs, () => { if (asks.delete(rid)) resolve(failure('REMOTE_TIMEOUT')); }) };
    asks.set(rid, entry);
    if (!transport.send({ ...message, rid })) {
      asks.delete(rid); cancel(entry.timer); resolve(failure('REMOTE_DISCONNECTED'));
    }
  });
  const answer = (rid, value) => {
    const entry = asks.get(rid);
    if (!entry) return;
    asks.delete(rid); cancel(entry.timer); entry.resolve(value);
  };

  // An accepted command is finished when its new state has arrived too, so a page that reads after the Promise sees it.
  const finishIfReady = operation => {
    if (operation.result !== null || operation.ack === undefined) return;
    const { kind, receipt } = operation.ack;
    if (receipt.status === 'accepted' && revision < receipt.revision) return;
    settle(operation, { ok: true, value: { kind, receipt } });
  };

  // ---- frames from the room --------------------------------------------------------
  function receive(frame) {
    if (disposed || frame === null || typeof frame !== 'object') return;
    switch (frame.t) {
      case 'state': {
        if (!Number.isSafeInteger(frame.revision) || frame.revision < revision) return;
        revision = frame.revision;
        cache = { status: frame.status, observation: frame.observation, requiredInput: frame.requiredInput,
          legalActions: frame.legalActions, actionBlocks: frame.actionBlocks };
        for (const event of frame.events ?? []) {
          if (event?.eventId !== undefined && seen.has(event.eventId)) continue;
          if (event?.eventId !== undefined) seen.add(event.eventId);
          feed.push(event);
        }
        for (const operation of operations.values()) finishIfReady(operation);
        if (resendOnState) {
          resendOnState = false;
          for (const operation of operations.values()) if (operation.result === null) sendCommand(operation);
        }
        changed();
        return;
      }
      case 'ack': {
        const operation = byRuntimeId.get(frame.commandId);
        if (!operation || operation.result !== null) return;
        operation.ack = { kind: frame.kind, receipt: frame.receipt };
        finishIfReady(operation);
        return;
      }
      case 'error': {
        if (frame.commandId !== undefined) {
          const operation = byRuntimeId.get(frame.commandId);
          if (!operation || operation.result !== null) return;
          // A refusal before any command ran: the same client command id may be used again.
          settle(operation, failure(frame.code));
          operations.delete(operation.clientId);
          byRuntimeId.delete(operation.runtimeId);
        } else if (frame.rid !== undefined) {
          answer(frame.rid, failure(frame.code));
        }
        return;
      }
      case 'planResult':
      case 'inspectResult':
        answer(frame.rid, frame.error ? { ok: false, error: frame.error } : { ok: true, value: frame.result });
        return;
      case 'end':
        if (frame.record) record = frame.record;
        changed();
        return;
      default:
    }
  }

  function sendCommand(operation) {
    return transport.send({ t: 'cmd', commandId: operation.runtimeId, expectedRevision: operation.intent.expectedRevision, action: operation.intent.action });
  }

  // The socket dropped: what was waiting for an answer gives up; the commands themselves are kept and sent again on return.
  function connectionLost() {
    if (disposed) return;
    for (const operation of operations.values()) {
      for (const waiter of operation.waiters.splice(0)) { cancel(waiter.timer); waiter.resolve(failure('REMOTE_DISCONNECTED')); }
    }
    for (const [rid, entry] of [...asks]) { asks.delete(rid); cancel(entry.timer); entry.resolve(failure('REMOTE_DISCONNECTED')); }
  }
  function connectionRestored() {
    if (!disposed) resendOnState = true;
  }

  // ---- the page's reads and writes ------------------------------------------------------
  const queryNow = () => cache ? { ok: true, value: clone(cache) } : failure('MATCH_SESSION_QUERY_UNAVAILABLE');

  const port = Object.freeze({
    query(input) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      if (input === undefined) return queryNow();
      const ref = input !== null && typeof input === 'object' && Reflect.ownKeys(input).length === 1 ? input.inspectRef : null;
      if (typeof ref !== 'string' || !/^r:[0-9a-f]{32}$/.test(ref)) return Promise.resolve(failure('INVALID_QUERY_INPUT'));
      return ask({ t: 'inspect', ref }).then(result => {
        if (!result.ok) return result;
        return cache ? { ok: true, value: { ...clone(cache), inspection: result.value } } : failure('MATCH_SESSION_QUERY_UNAVAILABLE');
      });
    },
    queryAction(input) {
      if (disposed) return Promise.resolve(failure('MATCH_SESSION_DISPOSED'));
      if (input === null || typeof input !== 'object' || !nonempty(input.actionId) || !Number.isSafeInteger(input.expectedRevision)
        || !Array.isArray(input.selections)) return Promise.resolve(failure('INVALID_PLANNING_INPUT'));
      return ask({ t: 'plan', expectedRevision: input.expectedRevision, actionId: input.actionId, selections: clone(input.selections) });
    },
    submit(input) {
      if (disposed) return Promise.resolve(failure('MATCH_SESSION_DISPOSED'));
      const intent = intentOf(input);
      if (!intent) return Promise.resolve(failure('INVALID_SESSION_INTENT'));
      const payload = JSON.stringify([intent.expectedRevision, intent.action]);
      let operation = operations.get(intent.commandId);
      if (operation) {
        if (operation.payload !== payload) return Promise.resolve(failure('MATCH_SESSION_COMMAND_COLLISION'));
        if (operation.result !== null) return Promise.resolve(clone(operation.result));
        if (!sendCommand(operation)) return Promise.resolve(failure('REMOTE_DISCONNECTED'));
        return wait(operation);
      }
      operation = { clientId: intent.commandId, runtimeId: `c.${nonce}.${operations.size + 1}.${++serial}`, payload, intent, result: null, ack: undefined, waiters: [] };
      if (!sendCommand(operation)) return Promise.resolve(failure('REMOTE_DISCONNECTED'));
      operations.set(operation.clientId, operation);
      byRuntimeId.set(operation.runtimeId, operation);
      return wait(operation);
    },
    receipt(clientCommandId) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      const operation = operations.get(clientCommandId);
      const receipt = operation?.result?.ok ? operation.result.value.receipt : operation?.ack?.receipt;
      return receipt ? { ok: true, value: clone(receipt) } : failure('RECEIPT_NOT_FOUND');
    },
    events(input = { afterEventId: null }) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      if (input === null || typeof input !== 'object' || Reflect.ownKeys(input).length !== 1) return failure('INVALID_EVENT_CURSOR');
      const after_ = input.afterEventId;
      if (after_ !== null && !nonempty(after_)) return failure('INVALID_EVENT_CURSOR');
      const index = after_ === null ? -1 : feed.findIndex(event => event.eventId === after_);
      if (after_ !== null && index < 0) return failure('UNKNOWN_EVENT_CURSOR');
      return { ok: true, value: { cursor: feed.at(-1)?.eventId ?? null, events: clone(feed.slice(index + 1)) } };
    },
    latest() {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      return queryNow();
    },
    dispose() { return { ok: true, value: null }; }
  });

  return Object.freeze({
    kind: 'remote',
    receive, connectionLost, connectionRestored,
    revision: () => revision,
    // Called after every state or end the room sends (readStamp has moved); the page then reads again.
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    viewerSeat: () => seat,
    scope: () => ({ matchId, sessionGeneration: 1, seatIds: [...seatIds] }),
    readStamp(viewerSeat) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      if (viewerSeat !== seat) return failure('MATCH_SESSION_UNKNOWN_SEAT');
      const available = cache !== null;
      return { ok: true, value: { matchId, sessionGeneration: 1, currentRevision: revision, modeEpoch: 0, viewerSeat: seat,
        adoptedRevision: revision, adoptedModeEpoch: 0, available } };
    },
    port(seatId) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      return seatId === seat ? { ok: true, value: port } : failure('MATCH_SESSION_UNKNOWN_SEAT');
    },
    // Known once the match is over; before that there is no record to keep.
    matchRecord() {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      // The record is the match's; `viewerSeat` says whose feed goes with it (a log is told from one seat).
      return record ? { ok: true, value: { ...clone(record), viewerSeat: seat } } : failure('MATCH_RECORD_UNAVAILABLE');
    },
    takeEvents(viewerSeat = seat) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      if (viewerSeat !== seat) return failure('MATCH_SESSION_UNKNOWN_SEAT');
      const read = port.events({ afterEventId: cursors.get(seat) ?? null });
      if (!read.ok) return read;
      cursors.set(seat, read.value.cursor);
      return { ok: true, value: read.value.events };
    },
    track(disposable) {
      if (disposed) return failure('MATCH_SESSION_DISPOSED');
      if (!disposable || typeof disposable.dispose !== 'function') return failure('INVALID_SESSION_DISPOSABLE');
      tracked.add(disposable);
      return { ok: true, value: null };
    },
    sandboxControl: () => failure('CAPABILITY_REQUIRED'),
    tutorial: () => failure('UNAVAILABLE_MODE'),
    tutorialState: () => failure('UNAVAILABLE_MODE'),
    advanceTutorial: () => failure('UNAVAILABLE_MODE'),
    dispose() {
      if (disposed) return { ok: true, value: null };
      for (const disposable of [...tracked].reverse()) { try { disposable.dispose(); } catch { /* one must not block the rest */ } }
      tracked.clear();
      listeners.clear();
      connectionLost();
      disposed = true;
      return { ok: true, value: null };
    }
  });
}
