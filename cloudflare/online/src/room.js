// One room as a Durable Object: sockets in, sockets out, SQLite for the match, an alarm for the deadlines.
// The rules of the room are src/network/room-core.js; this file only connects it to the platform.
import { createRoomCore } from '../../../src/network/room-core.js';
import { createRuntimeEngine } from '../../../src/network/runtime-engine.js';
import { checkDeckChoice } from '../../../src/network/deck-check.js';
import { AUTH_LIMITS, verifyTicket } from '../../../src/network/discord-auth.js';
import { buildMatchLog } from '../../../src/adapters/match-log.js';
import { createSqlStore } from './sql-store.js';

// A plain class, as Durable Objects were before RPC: the platform passes (ctx, env) and calls fetch, webSocketMessage and the rest.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sockets = new Map();
    this.engine = createRuntimeEngine();
    this.core = createRoomCore({
      clock: { now: () => Date.now() },
      store: createSqlStore(ctx.storage.sql),
      random: { bytes: count => crypto.getRandomValues(new Uint8Array(count)) },
      send: (connId, text) => { this.sockets.get(connId)?.send(text); },
      close: (connId, code, reason) => {
        const socket = this.sockets.get(connId);
        this.sockets.delete(connId);
        socket?.close(code, reason);
      },
      schedule: at => {
        const done = at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at);
        done.catch(() => {});
      },
      engine: this.engine,
      checkDeck: checkDeckChoice,
      // A Discord ticket is checked with the Worker secret AUTH_KEY; without it every ticket is "unavailable" and guests play on.
      verifyProfile: (ticket, tokenHash) => typeof env.AUTH_KEY === 'string' && env.AUTH_KEY.length >= AUTH_LIMITS.secretMinChars
        ? verifyTicket(ticket, { secret: env.AUTH_KEY, tokenHash }) : { ok: false, error: { code: 'UNAVAILABLE' } },
      // The socket keeps who it belongs to, so a room that went to sleep knows it again.
      onAuthenticated: (connId, hash) => { this.sockets.get(connId)?.serializeAttachment({ id: connId, hash }); },
      onFinish: info => { ctx.waitUntil(this.writeLog(info)); }
    });
    // "ping" is answered by the platform without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // Sockets that outlived this object's memory are registered again before any message is handled.
    ctx.blockConcurrencyWhile(async () => {
      for (const socket of ctx.getWebSockets()) {
        const saved = socket.deserializeAttachment();
        if (!saved?.id) { socket.close(1011, 'unknown socket'); continue; }
        this.sockets.set(saved.id, socket);
        if (saved.hash) await this.core.restore(saved.id, saved.hash);
        else await this.core.connect(saved.id);
      }
      await this.core.startup();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/init') {
      let body;
      try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
      if (typeof body?.code !== 'string') return new Response(null, { status: 400 });
      const made = await this.core.init({ code: body.code });
      return new Response(null, { status: made.ok ? 201 : 409 });
    }
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair();
      const connId = crypto.randomUUID();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ id: connId, hash: null });
      this.sockets.set(connId, server);
      await this.core.connect(connId);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response(null, { status: 404 });
  }

  idOf(socket) { return socket.deserializeAttachment()?.id ?? null; }

  async webSocketMessage(socket, message) {
    const connId = this.idOf(socket);
    if (connId) await this.core.receive(connId, message);
  }

  async webSocketClose(socket) {
    const connId = this.idOf(socket);
    if (connId) await this.core.disconnect(connId);
    this.sockets.delete(connId);
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    await this.core.alarm();
  }

  // A finished match is kept as one log in the match-log KV (the same shape the log Worker stores).
  async writeLog({ game, record }) {
    if (!this.env.MATCH_LOGS || !game || !record?.summary?.finished) return;
    try {
      const events = this.engine.history({ game, commands: record.commands }, game.seatIds[0]);
      const log = buildMatchLog(record, events);
      const key = `log/${log.endedAt.slice(0, 10)}/${log.matchId}`;
      if (await this.env.MATCH_LOGS.get(key) !== null) return;
      await this.env.MATCH_LOGS.put(key, JSON.stringify(log), { metadata: { mode: log.mode, result: log.result, turns: log.turns } });
    } catch { /* the match is over either way */ }
  }
}
