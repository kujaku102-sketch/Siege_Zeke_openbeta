// The page's online client against a real room (room-core + the real runtime) over fake sockets, in one process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineClient, TOKEN_KEY } from '../src/network/online-client.js';
import { createRoomCore } from '../src/network/room-core.js';
import { createRuntimeEngine } from '../src/network/runtime-engine.js';
import { checkDeckChoice } from '../src/network/deck-check.js';
import { createRoomCode, parseRoomCode, randomRoomBody } from '../src/network/room-code.js';
import { LIMITS } from '../src/network/protocol.js';
import { issueTicket, verifyTicket } from '../src/network/discord-auth.js';
import { sha256Hex } from '../src/network/room-code.js';
import { memoryStore } from './online-test-kit.js';
import { archiveRetiredMatch } from '../src/adapters/match-archive.js';
import { loadStored, MATCH_LOGS, REPLAYS } from '../src/adapters/match-record-store.js';

const KEY = 'test-only-room-key-0123456789';
const ENDPOINT = 'http://127.0.0.1:8801';
const AUTH_KEY = 'test-only-auth-key-0123456789abcdef';
// The rooms hash tokens with the real WebCrypto (a thread-pool job), so a few real milliseconds are part of settling.
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setTimeout(resolve, 8)); };

// A clock and timers moved by hand; the rooms' alarms run on the same clock.
function world() {
  let time = Date.UTC(2026, 10, 5, 12), next = 1;
  const timers = new Map();
  const hooks = [];
  const self = {
    now: () => time,
    after: (ms, fn) => { const id = next++; timers.set(id, { at: time + ms, fn }); return id; },
    cancel: id => { timers.delete(id); },
    onTick: fn => hooks.push(fn),
    async advance(ms) {
      const end = time + ms;
      await settle(2);
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        const alarm = Math.min(...hooks.map(hook => hook.next()).filter(at => at !== null), Infinity);
        const step = Math.min(due ? due[1].at : Infinity, alarm <= end ? alarm : Infinity);
        if (step === Infinity) break;
        time = Math.max(time, step);
        if (due && due[1].at <= time) { timers.delete(due[0]); due[1].fn(); }
        for (const hook of hooks) await hook.run(time);
        await settle(3);
      }
      time = end;
      await settle(3);
    }
  };
  return self;
}

class FakeSocket {
  constructor(room, id) { this.room = room; this.id = id; this.readyState = 0; this.opened = false; this.early = []; this.listeners = { open: [], message: [], close: [], error: [] }; }
  addEventListener(type, fn) { this.listeners[type].push(fn); }
  emit(type, event) { for (const fn of this.listeners[type]) fn(event); }
  send(text) { if (this.readyState !== 1) throw new Error('not open'); void this.room.core.receive(this.id, text); }
  close(code = 1000) { if (this.readyState >= 2) return; this.readyState = 3; this.room.sockets.delete(this.id); void this.room.core.disconnect(this.id); this.emit('close', { code }); }
  // What the room says while the handshake is still finishing reaches the page right after `open`, as on a real socket.
  deliver(text) { if (!this.opened) this.early.push(['message', { data: text }]); else if (this.readyState === 1) this.emit('message', { data: text }); }
  closedByServer(code) { if (this.readyState >= 2) return; this.readyState = 3; if (!this.opened) this.early.push(['close', { code }]); else this.emit('close', { code }); }
  finishOpen() { this.opened = true; this.emit('open', {}); for (const [type, event] of this.early.splice(0)) this.emit(type, event); }
  lose() { if (this.readyState >= 2) return; this.readyState = 3; this.room.sockets.delete(this.id); void this.room.core.disconnect(this.id); this.emit('close', { code: 1006 }); }
}

function server(w) {
  const rooms = new Map();
  const engine = createRuntimeEngine();
  let counter = 0;
  const api = {
    down: false, fetches: 0,
    rooms,
    roomFor(body) {
      if (rooms.has(body)) return rooms.get(body);
      const room = { sockets: new Map(), alarmAt: null, store: memoryStore() };
      room.core = createRoomCore({ clock: { now: w.now }, store: room.store, engine, checkDeck: checkDeckChoice,
        random: { bytes: count => crypto.getRandomValues(new Uint8Array(count)) },
        send: (id, text) => room.sockets.get(id)?.deliver(text),
        close: (id, code) => { const socket = room.sockets.get(id); room.sockets.delete(id); socket?.closedByServer(code); },
        verifyProfile: (ticket, tokenHash) => verifyTicket(ticket, { secret: AUTH_KEY, tokenHash, now: w.now() }),
        schedule: at => { room.alarmAt = at; } });
      rooms.set(body, room);
      return room;
    },
    async fetch(url, init = {}) {
      api.fetches += 1;
      if (api.down) throw new TypeError('Failed to fetch');
      const path = new URL(url).pathname;
      if (path === '/rooms' && init.method === 'POST') {
        const body = randomRoomBody(crypto.getRandomValues(new Uint8Array(6)));
        const code = await createRoomCode(body, KEY);
        await api.roomFor(body).core.init({ code });
        return new Response(JSON.stringify({ code }), { status: 201 });
      }
      const m = /^\/rooms\/([^/]+)\/ws$/.exec(path);
      if (m) return new Response(null, { status: (await parseRoomCode(decodeURIComponent(m[1]), KEY)).ok ? 426 : 404 });
      return new Response(null, { status: 404 });
    },
    createSocket(url) {
      const code = decodeURIComponent(new URL(url).pathname.split('/')[2]);
      const id = `s${++counter}`;
      const placeholder = { sockets: new Map(), core: null };
      const socket = new FakeSocket(placeholder, id);
      (async () => {
        const parsed = await parseRoomCode(code, KEY);
        if (api.down || !parsed.ok) { socket.readyState = 3; socket.emit('error', {}); socket.emit('close', { code: 1006 }); return; }
        const room = api.roomFor(parsed.body);
        socket.room = room;
        room.sockets.set(id, socket);
        socket.readyState = 1;
        await room.core.connect(id);
        socket.finishOpen();
      })();
      return socket;
    },
    // Rooms whose alarm is due run it.
    hook: { next: () => Math.min(...[...rooms.values()].map(room => room.alarmAt).filter(at => at !== null), Infinity) === Infinity ? null : Math.min(...[...rooms.values()].map(room => room.alarmAt).filter(at => at !== null)),
      run: async time => { for (const room of rooms.values()) if (room.alarmAt !== null && room.alarmAt <= time) { room.alarmAt = null; await room.core.alarm(); } } },
    dropAll() { for (const room of rooms.values()) for (const socket of [...room.sockets.values()]) socket.lose(); }
  };
  w.onTick(api.hook);
  return api;
}

function pageStorage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, String(value)); } };
}
function page(w, s, storage = pageStorage()) {
  return createOnlineClient({ endpoint: ENDPOINT, storage, createSocket: url => s.createSocket(url), fetchImpl: (url, init) => s.fetch(url, init),
    now: w.now, after: w.after, cancel: w.cancel, random: () => 0.5 });
}
const START = { userId: 'doors_zx', deck: { kind: 'start', deckId: 'start-red' } };
const OTHER = { userId: 'doors_zx', deck: { kind: 'start', deckId: 'start-yellow' } };

async function matched() {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  await a.createRoom({ name: 'ゆうき' });
  await b.joinRoom(a.state().display.toLowerCase(), { name: 'たろう' });
  a.setReady(START); b.setReady(OTHER);
  await settle();
  return { w, s, a, b };
}

test('one guest makes a room and the other joins it by the typed code; both ready, and the match runs', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  const created = await a.createRoom({ name: 'ゆうき' });
  assert.equal(created.ok, true);
  const first = a.state();
  assert.equal(first.status, 'lobby');
  assert.equal(first.connection, 'open');
  assert.match(first.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(first.display, `${first.code.slice(0, 4)}-${first.code.slice(4)}`);
  assert.equal(first.you.name, 'ゆうき');
  assert.equal(first.opponent, null);
  assert.ok(first.expiresAt > w.now() && first.expiresAt <= w.now() + LIMITS.waitingMs);
  const seen = [];
  a.subscribe(state => seen.push(state.opponent?.name ?? null));
  assert.equal((await b.joinRoom(` ${first.display.toLowerCase()} `, { name: 'たろう' })).ok, true);
  await settle();
  assert.equal(b.state().status, 'lobby');
  assert.equal(b.state().opponent.name, 'ゆうき');
  assert.equal(a.state().opponent.name, 'たろう');
  assert.ok(seen.includes('たろう'), 'subscribers hear about it');
  assert.equal(a.session(), null, 'no match yet');
  a.setReady(START);
  await settle();
  assert.equal(b.state().opponent.ready, true);
  assert.equal(b.state().opponent.userId, 'doors_zx');
  b.setReady(OTHER);
  await settle();
  for (const client of [a, b]) {
    assert.equal(client.state().status, 'playing');
    assert.ok(client.state().match.matchId);
    assert.equal(client.session().kind, 'remote');
    assert.equal(client.session().scope().matchId, client.state().match.matchId);
  }
  assert.equal(a.state().match.matchId, b.state().match.matchId);
  assert.notEqual(a.session().viewerSeat(), b.session().viewerSeat());
  assert.equal(a.session().scope().seatIds[0], a.session().viewerSeat(), 'a guest is always seatIds[0] of their own session');
  assert.equal(a.session().scope().seatIds[1], b.session().viewerSeat());
  assert.equal(a.session().readStamp(a.session().viewerSeat()).value.available, true);
});

test('the guest token is made once, kept in storage, and never part of the state', async () => {
  const w = world(), s = server(w), storage = pageStorage();
  const a = page(w, s, storage);
  assert.match(storage.items.get(TOKEN_KEY), /^[0-9a-f]{32}$/);
  assert.equal(page(w, s, storage).token(), a.token(), 'the next page load has the same token');
  assert.notEqual(page(w, s).token(), a.token(), 'another browser has another');
  await a.createRoom({ name: 'x' });
  assert.equal(JSON.stringify(a.state()).includes(a.token()), false);
});

test('a command through the remote session reaches the room, both pages see the new state, and a plan is asked of the room', async () => {
  const { a, b } = await matched();
  const sa = a.session(), sb = b.session();
  const pa = sa.port(sa.viewerSeat()).value, pb = sb.port(sb.viewerSeat()).value;
  const [mover, other] = pa.query().value.status.activeSeat === sa.viewerSeat() ? [pa, pb] : [pb, pa];
  const entry = mover.query().value.legalActions.find(item => item.actionType === 'openingMulligan');
  assert.ok(entry);
  const plan = await mover.queryAction({ expectedRevision: 0, actionId: entry.actionId, selections: [] });
  assert.equal(plan.ok, true);
  assert.equal(plan.value.selectionRequests.length, 1);
  assert.equal((await other.queryAction({ expectedRevision: 0, actionId: entry.actionId, selections: [] })).error.code, 'ACTION_NOT_ALLOWED');
  const done = await mover.submit({ commandId: 'gui:1', expectedRevision: 0, action: { type: 'keepOpeningHand' } });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.value.receipt.status, 'accepted');
  const afterRevision = mover.latest().value.status.revision;
  assert.ok(afterRevision >= 1);
  await settle();
  assert.equal(other.latest().value.status.revision, afterRevision, 'the other page has the same revision');
  assert.ok(mover.events().value.events.length > 0 && other.events().value.events.length > 0);
  const stale = await mover.submit({ commandId: 'gui:2', expectedRevision: 0, action: { type: 'keepOpeningHand' } });
  assert.equal(stale.ok, true);
  assert.equal(stale.value.receipt.status, 'rejected');
  assert.equal(stale.value.receipt.reasonCode, 'STALE_REVISION');
});

test('what a room refuses shows as an error in the state, and the page is back where it can try again', async () => {
  const w = world(), s = server(w);
  const a = page(w, s);
  const typo = await a.joinRoom('ABCD2345');
  assert.equal(typo.ok, false);
  assert.equal(a.state().error.code, 'ROOM_CODE_INVALID');
  assert.equal(a.state().status, 'idle');
  const before = s.fetches;
  assert.equal((await a.joinRoom('ABC')).ok, false);
  assert.equal(a.state().error.code, 'ROOM_CODE_INVALID');
  assert.equal(s.fetches, before, 'a code of the wrong shape never leaves the page');
  const ghost = await createRoomCode('AAAAAA', KEY);
  assert.equal((await a.joinRoom(ghost)).ok, false);
  assert.equal(a.state().error.code, 'ROOM_NOT_FOUND');
  assert.equal(a.state().status, 'idle');
  const host = page(w, s), b = page(w, s), c = page(w, s);
  await host.createRoom(); await b.joinRoom(host.state().code);
  assert.equal((await c.joinRoom(host.state().code)).ok, false);
  assert.equal(c.state().error.code, 'ROOM_FULL');
  s.down = true;
  assert.equal((await a.createRoom()).ok, false);
  assert.equal(a.state().error.code, 'SERVER_UNREACHABLE');
  assert.equal((await a.joinRoom(host.state().code)).ok, false);
  assert.equal(a.state().error.code, 'SERVER_UNREACHABLE');
  s.down = false;
  assert.equal((await a.createRoom()).ok, true, 'and it works again afterwards');
});

test('a deck the room refuses is reported and the guest can choose again', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  await a.createRoom(); await b.joinRoom(a.state().code);
  const errors = [];
  a.subscribe(state => { if (state.error) errors.push(state.error.code); });
  a.setReady({ userId: 'doors_zx', deck: { kind: 'start', deckId: 'red' } });
  await settle();
  assert.ok(errors.includes('DECK_INVALID'));
  assert.equal(a.state().you.ready, false);
  a.setReady(START);
  await settle();
  assert.equal(b.state().opponent.ready, true);
});

test('leaving the lobby frees the seat for someone else', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  await a.createRoom(); await b.joinRoom(a.state().code);
  b.leave();
  await settle();
  assert.equal(b.state().status, 'idle');
  assert.equal(a.state().opponent, null);
  assert.equal(a.state().status, 'lobby');
  const c = page(w, s);
  assert.equal((await c.joinRoom(a.state().code)).ok, true);
});

test('a dropped connection is retried; the other guest sees the time left, and the match goes on afterwards', async () => {
  const { w, s, a, b } = await matched();
  const sa = a.session();
  const keptSessions = [a.session(), b.session()];
  const mine = sa.port(sa.viewerSeat()).value;
  const revision = mine.latest().value.status.revision;
  const lostAt = w.now();
  s.down = true;
  for (const room of s.rooms.values()) for (const socket of [...room.sockets.values()]) if (socket.id && a.state().you) { socket.lose(); break; }
  await settle();
  const dropped = [a, b].find(client => client.state().connection === 'reconnecting');
  const stayed = dropped === a ? b : a;
  assert.ok(dropped, 'one page noticed');
  assert.equal(dropped.state().selfAwayUntil, lostAt + LIMITS.graceMs);
  assert.equal(stayed.state().opponent.connected, false);
  assert.equal(stayed.state().opponentAwayUntil, lostAt + LIMITS.graceMs);
  const droppedPort = dropped.session().port(dropped.session().viewerSeat()).value;
  assert.equal(droppedPort.query().ok, true, 'it still shows the last state');
  assert.equal((await droppedPort.submit({ commandId: 'gui:1', expectedRevision: revision, action: { type: 'endTurn' } })).error.code, 'REMOTE_DISCONNECTED');
  assert.ok(dropped.state().retryInMs > 0, 'the first try failed and the next is scheduled');
  s.down = false;
  await w.advance(1000);
  assert.equal(dropped.state().connection, 'open');
  assert.equal(dropped.state().selfAwayUntil, null);
  assert.equal(stayed.state().opponent.connected, true);
  assert.equal(stayed.state().opponentAwayUntil, null);
  assert.equal(droppedPort.latest().value.status.revision, revision);
  assert.equal(dropped.state().status, 'playing');
  assert.ok(keptSessions.includes(dropped.session()) && keptSessions.includes(stayed.session()), 'the same sessions carry on');
});

test('a page that is reloaded takes its seat back with the same token and gets the whole log', async () => {
  const w = world(), s = server(w), storageA = pageStorage();
  const a = page(w, s, storageA), b = page(w, s);
  await a.createRoom({ name: 'ゆうき' }); await b.joinRoom(a.state().code);
  a.setReady(START); b.setReady(OTHER);
  await settle();
  const [first] = a.session().port(a.session().viewerSeat()).value.query().value.status.activeSeat === a.session().viewerSeat() ? [a, b] : [b, a];
  const mover = first.session().port(first.session().viewerSeat()).value;
  await mover.submit({ commandId: 'gui:1', expectedRevision: 0, action: { type: 'keepOpeningHand' } });
  const seat = a.session().viewerSeat(), code = a.state().code;
  const feedBefore = a.session().port(seat).value.events().value.events.length;
  a.dispose();
  s.dropAll();
  await settle();
  const again = page(w, s, storageA);
  assert.equal(again.token(), a.token());
  assert.equal((await again.joinRoom(code)).ok, true);
  await settle();
  assert.equal(again.state().status, 'playing');
  assert.equal(again.session().viewerSeat(), seat, 'the same seat');
  assert.equal(again.session().port(seat).value.events().value.events.length, feedBefore, 'the log is rebuilt: the same number of events as before');
});

test('a concession ends the match for both pages, and the record is kept for the one who wants it', async () => {
  const { a, b } = await matched();
  a.concede();
  await settle();
  assert.deepEqual(a.state().outcome, { result: 'lose', reason: 'concede' });
  assert.deepEqual(b.state().outcome, { result: 'win', reason: 'concede' });
  assert.equal(a.state().status, 'finished');
  const record = b.session().matchRecord();
  assert.equal(record.ok, true);
  assert.equal(record.value.kind, 'siege-zeke.replay');
  assert.equal(record.value.summary.finished, true);
});

test('when the connection cannot be restored the page says so, and the room gives the match to the other guest', async () => {
  const { w, s, a, b } = await matched();
  s.down = true;
  s.dropAll();
  await settle();
  assert.equal(a.state().connection, 'reconnecting');
  await w.advance(LIMITS.graceMs + 20_000);
  for (const client of [a, b]) {
    assert.equal(client.state().connection, 'down');
    assert.equal(client.state().error.code, 'CONNECTION_LOST');
  }
  s.down = false;
  // With both away nobody lost: the room ended the match without a winner.
  const room = [...s.rooms.values()][0].core.snapshot();
  assert.equal(room.outcome.kind, 'aborted');
});

test('opening the same seat from another page closes the first with REPLACED', async () => {
  const w = world(), s = server(w), storage = pageStorage();
  const a = page(w, s, storage);
  await a.createRoom();
  const code = a.state().code;
  const other = page(w, s, storage);
  assert.equal((await other.joinRoom(code)).ok, true);
  await settle();
  assert.equal(a.state().error.code, 'REPLACED');
  assert.equal(a.state().connection, 'down');
  assert.equal(other.state().status, 'lobby');
});

test('either guest can keep a finished match in this browser, and the log is told from their own seat', async () => {
  const { a, b } = await matched();
  const [mover] = a.session().port(a.session().viewerSeat()).value.query().value.status.activeSeat === a.session().viewerSeat() ? [a] : [b];
  await mover.session().port(mover.session().viewerSeat()).value.submit({ commandId: 'gui:1', expectedRevision: 0, action: { type: 'keepOpeningHand' } });
  a.concede();
  await settle();
  const keep = client => {
    const items = new Map();
    const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
    const result = archiveRetiredMatch(client.session(), { storage });
    return { result, log: loadStored(storage, MATCH_LOGS)[0], replay: loadStored(storage, REPLAYS)[0] };
  };
  const mine = keep(a), theirs = keep(b);
  assert.equal(mine.result.kept, true);
  assert.equal(theirs.result.kept, true);
  assert.equal(mine.log.matchId, theirs.log.matchId);
  assert.equal(mine.log.mode, 'online');
  assert.equal(mine.log.result, 'opponent', 'A conceded');
  assert.equal(theirs.log.result, 'you', 'B won');
  assert.equal(mine.log.players.you.seat, a.session().viewerSeat());
  assert.equal(theirs.log.players.you.seat, b.session().viewerSeat());
  assert.notEqual(mine.log.players.you.deck.name, theirs.log.players.you.deck.name, 'each side shows their own deck');
  assert.ok(mine.log.log.length > 0 && theirs.log.log.length > 0);
  assert.equal(JSON.stringify(mine.log).includes(a.token()), false);
  assert.equal(mine.replay.viewerSeat, a.session().viewerSeat());
});

// ---- Discord tickets through the client ----------------------------------------------------------------
const ID = '80351110224678912';
const AVATAR_URL = `https://cdn.discordapp.com/avatars/${ID}/a1b2c3d4e5f60718293a4b5c6d7e8f90.png?size=128`;
const ticketFor = async (client, w, profile = { id: ID, name: 'ゆうき', avatar: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', defaultIndex: 4 }) =>
  (await issueTicket({ secret: AUTH_KEY, tokenHash: await sha256Hex(client.token()), profile, now: w.now() })).ticket;

test('a ticket given to createRoom shows the picture to both pages; a guest has none', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  const made = await a.createRoom({ name: 'ゆうき', ticket: await ticketFor(a, w) });
  assert.equal(made.ok, true);
  assert.equal(a.state().ticketStatus, 'ok');
  assert.equal(a.state().you.avatar, AVATAR_URL);
  await b.joinRoom(a.state().code, { name: 'たろう' });
  assert.equal(b.state().ticketStatus, 'none');
  assert.equal(b.state().you.avatar, null);
  assert.equal(b.state().opponent.avatar, AVATAR_URL, 'the second page sees the first page picture');
  await settle();
  assert.equal(a.state().opponent.avatar, null);
  a.setReady(START); b.setReady(OTHER);
  await settle();
  assert.equal(a.state().status, 'playing');
  assert.equal(b.state().opponent.avatar, AVATAR_URL, 'it stays through the start frame');
  assert.equal(a.state().you.avatar, AVATAR_URL);
});

test('a ticket that does not pass is no reason to stay out: the page plays on without a picture and is told why', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  const foreign = await ticketFor({ token: () => 'f'.repeat(32) }, w);
  assert.equal((await a.createRoom({ name: 'A', ticket: foreign })).ok, true);
  assert.equal(a.state().ticketStatus, 'invalid');
  assert.equal(a.state().you.avatar, null);
  const old = await issueTicket({ secret: AUTH_KEY, tokenHash: await sha256Hex(b.token()), profile: { id: ID, name: 'x', avatar: null, defaultIndex: 1 }, now: w.now() - 31 * 24 * 3600 * 1000 });
  assert.equal((await b.joinRoom(a.state().code, { name: 'B', ticket: old.ticket })).ok, true);
  assert.equal(b.state().ticketStatus, 'expired');
  a.setReady(START); b.setReady(OTHER);
  await settle();
  assert.equal(a.state().status, 'playing');
  assert.equal(b.state().status, 'playing');
});

test('the ticket is sent again when the page reconnects, and a page that joins without one sends none', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  await a.createRoom({ name: 'ゆうき', ticket: await ticketFor(a, w) });
  await b.joinRoom(a.state().code, { name: 'たろう' });
  a.setReady(START); b.setReady(OTHER);
  await settle();
  s.dropAll();
  await settle();
  await w.advance(1000);
  assert.equal(a.state().connection, 'open');
  assert.equal(a.state().ticketStatus, 'ok', 'the room was shown the ticket again');
  assert.equal(a.state().you.avatar, AVATAR_URL);
  assert.equal(b.state().ticketStatus, 'none');
  assert.equal(b.state().opponent.avatar, AVATAR_URL);
  a.leave(); b.leave();
  const c = page(w, s);
  await c.createRoom({ name: 'C' });
  assert.equal(c.state().ticketStatus, 'none', 'a new room without a ticket carries none from the old one');
});

test('a picture that is not one of Discord own addresses never reaches a screen', async () => {
  const w = world(), s = server(w);
  const a = page(w, s), b = page(w, s);
  await a.createRoom({ name: 'A' });
  await b.joinRoom(a.state().code, { name: 'B' });
  await settle();
  const socket = [...s.rooms.values()][0].sockets.values().next().value;
  const seat = (name, avatar) => ({ slot: 0, name, avatar, ready: false, seat: null, connected: true, graceMs: null });
  for (const avatar of ['https://evil.example/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 5, {}, '']) {
    socket.deliver(JSON.stringify({ v: 1, t: 'lobby', phase: 'lobby', you: seat('me', avatar), opponent: seat('them', avatar), expiresInMs: 1000 }));
    const state = [a, b].map(client => client.state()).find(candidate => candidate.opponent?.name === 'them');
    if (state) {
      assert.equal(state.you.avatar, null, String(avatar));
      assert.equal(state.opponent.avatar, null, String(avatar));
    }
  }
  socket.deliver(JSON.stringify({ v: 1, t: 'lobby', phase: 'lobby', you: seat('me', AVATAR_URL), opponent: seat('them', 'https://cdn.discordapp.com/embed/avatars/3.png'), expiresInMs: 1000 }));
  const shown = [a, b].map(client => client.state()).find(candidate => candidate.opponent?.name === 'them');
  assert.equal(shown.you.avatar, AVATAR_URL);
  assert.equal(shown.opponent.avatar, 'https://cdn.discordapp.com/embed/avatars/3.png');
});
