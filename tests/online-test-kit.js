// Shared helpers for the online-room tests (not a test file). A room is driven the way a host drives it:
// connect / receive / disconnect, and alarm() when the scheduled time has come.
import { createRoomCore } from '../src/network/room-core.js';

export function memoryStore() {
  const map = new Map();
  return {
    map,
    get: key => map.has(key) ? structuredClone(map.get(key)) : undefined,
    put: (key, value) => { map.set(key, structuredClone(value)); },
    delete: key => { map.delete(key); },
    deleteAll: () => { map.clear(); },
    list: prefix => [...map.keys()].filter(key => key.startsWith(prefix)).sort().map(key => structuredClone(map.get(key)))
  };
}

// A small stand-in match: three accepted `go` commands end it with seat 0 the winner.
export function fakeEngine({ winAfter = 3 } = {}) {
  const view = authority => ({ ok: true, value: { status: { revision: authority.revision }, observation: { seats: [] },
    requiredInput: null, legalActions: [], actionBlocks: { general: null, cards: [] } } });
  return {
    start: ({ matchId, seatIds, seed, players }) => ({ ok: true, game: { matchId, seatIds, seed, players }, authority: { matchId, seatIds, revision: 0, seen: [] } }),
    submit(authority, seatId, intent) {
      if (!authority.seatIds.includes(seatId)) return { ok: false, error: { code: 'NOT_AUTHORIZED' } };
      if (authority.seen.includes(intent.commandId)) {
        return { ok: true, kind: 'retry', receipt: { commandId: intent.commandId, status: 'accepted', revision: authority.revision }, authority };
      }
      const receipt = { commandId: intent.commandId, revision: authority.revision };
      if (intent.expectedRevision !== authority.revision) {
        return { ok: true, kind: 'rejected', receipt: { ...receipt, status: 'rejected', reasonCode: 'STALE_REVISION' },
          authority: { ...authority, seen: [...authority.seen, intent.commandId] } };
      }
      const next = { ...authority, revision: authority.revision + 1, seen: [...authority.seen, intent.commandId] };
      return { ok: true, kind: 'accepted', receipt: { ...receipt, revision: next.revision, status: 'accepted' }, authority: next,
        eventsFor: viewer => [{ eventId: `e${next.revision}`, viewer }] };
    },
    view,
    plan: (authority, seatId, input) => ({ ok: true, value: { seatId, input } }),
    inspect: () => ({ ok: false, error: { code: 'INSPECTION_NOT_ALLOWED' } }),
    outcome: authority => authority.revision >= winAfter ? { kind: 'win', winnerSeat: authority.seatIds[0] } : null,
    serialize: authority => JSON.stringify(authority),
    restore: text => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, error: { code: 'BAD' } }; } },
    encodeCommand: (before, seatId, action) => ({ ok: true, value: { seat: seatId, action } }),
    record: ({ game, commands, authority }) => ({ ok: true, value: { kind: 'fake.record', game, commands, revision: authority.revision } })
  };
}

export const acceptAnyDeck = ({ userId, deck }) => ({ ok: true, value: { userId, deckId: deck.deckId ?? null, recipe: deck.recipe ?? null } });
export const START_DECK = { kind: 'start', deckId: 'start-red' };

const randomHex = bytes => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');

export function createHarness({ engine = fakeEngine(), checkDeck = acceptAnyDeck, store = memoryStore(), at = Date.UTC(2026, 10, 5, 12), extra = {} } = {}) {
  let time = at;
  let alarmAt = null;
  let nextConn = 0;
  const frames = new Map();
  const closed = new Map();
  const finished = [];
  const core = createRoomCore({
    clock: { now: () => time }, store, engine, checkDeck,
    random: { bytes: count => crypto.getRandomValues(new Uint8Array(count)) },
    send: (connId, text) => { frames.get(connId)?.push(JSON.parse(text)); },
    close: (connId, code, reason) => { closed.set(connId, { code, reason }); },
    schedule: next => { alarmAt = next; },
    onFinish: info => finished.push(info),
    ...extra
  });
  const harness = {
    core, store, finished, closed, engine,
    now: () => time,
    alarmAt: () => alarmAt,
    room: () => core.snapshot(),
    // Moves the clock, then runs what has come due, the way a host's timer would.
    async advance(ms) {
      time += ms;
      for (let round = 0; round < 20; round += 1) {
        let progressed = false;
        await new Promise(resolve => setImmediate(resolve));
        if (alarmAt !== null && alarmAt <= time) {
          const before = alarmAt;
          await core.alarm();
          if (alarmAt !== before) progressed = true;
        }
        if (!progressed) break;
      }
    },
    client(name = 'guest') {
      const connId = `conn-${++nextConn}`;
      const token = randomHex(16);
      frames.set(connId, []);
      const client = {
        connId, token, name,
        get seat() { return client.last('start')?.you.seat ?? null; },
        get frames() { return frames.get(connId); },
        last: type => [...frames.get(connId)].reverse().find(frame => frame.t === type),
        all: type => frames.get(connId).filter(frame => frame.t === type),
        get closed() { return closed.get(connId) ?? null; },
        open: () => core.connect(connId),
        send: message => core.receive(connId, JSON.stringify({ v: 1, ...message })),
        raw: text => core.receive(connId, text),
        async hello(extraFields = {}) { await core.receive(connId, JSON.stringify({ v: 1, t: 'hello', token: client.token, name, ...extraFields })); return client; },
        async join(extraFields = {}) { await client.open(); await client.hello(extraFields); return client; },
        async ready(userId = 'doors_zx', deck = START_DECK) { await client.send({ t: 'ready', userId, deck }); return client; },
        drop: () => core.disconnect(connId)
      };
      return client;
    }
  };
  return harness;
}

// A room with two guests already joined and ready, so the match has started.
export async function startedRoom(options = {}) {
  const harness = createHarness(options);
  await harness.core.init({ code: 'ABCD2345' });
  const a = harness.client('A'), b = harness.client('B');
  await a.join();
  await b.join();
  await a.ready();
  await b.ready();
  return { harness, a, b };
}
