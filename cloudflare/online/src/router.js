// The online door: hands out room codes and passes a WebSocket to the room it names.
// It does no game work. A code whose check characters are wrong is refused here, before any room is woken.
import { createRoomCode, formatRoomCode, parseRoomCode, randomRoomBody } from '../../../src/network/room-code.js';
import { authExchange, authStart } from './auth.js';


// The site, its Pages address and preview deployments, and local dev (the same pages the log Worker accepts).
const ALLOWED_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*siegezeke\.online$/, /^https:\/\/([a-z0-9-]+\.)?siege-zeke-simple-public\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ROOM_URL = 'https://room.internal';
const CREATE_TRIES = 3;

const cors = origin => ({ ...(origin ? { 'access-control-allow-origin': origin } : {}), 'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type', vary: 'origin' });
const reply = (status, origin, body = null, type = null) => new Response(body, { status, headers: { ...cors(origin), ...(type ? { 'content-type': type } : {}) } });
const json = (status, origin, value) => reply(status, origin, JSON.stringify(value), 'application/json');
const roomOf = (env, body) => env.ROOM.get(env.ROOM.idFromName(`room:${body}`));
const keyOk = env => typeof env.ROOM_CODE_KEY === 'string' && env.ROOM_CODE_KEY.length >= 16;

async function createRoom(env, origin) {
  if (!keyOk(env)) return json(500, origin, { code: 'SERVER_MISCONFIGURED' });
  for (let attempt = 0; attempt < CREATE_TRIES; attempt += 1) {
    const body = randomRoomBody(crypto.getRandomValues(new Uint8Array(6)));
    const code = await createRoomCode(body, env.ROOM_CODE_KEY);
    const made = await roomOf(env, body).fetch(`${ROOM_URL}/init`, { method: 'POST', body: JSON.stringify({ code }) });
    if (made.status === 201) return json(201, origin, { code, display: formatRoomCode(code) });
    if (made.status !== 409) return json(503, origin, { code: 'ROOM_UNAVAILABLE' });
  }
  return json(503, origin, { code: 'ROOM_UNAVAILABLE' });
}

const MAX_AUTH_BODY = 4096;
const AUTH_ROUTES = { '/auth/discord/start': authStart, '/auth/discord/exchange': authExchange };

// A small JSON body: the size is checked while reading, so a long one is never held whole.
async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_AUTH_BODY) return null;
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_AUTH_BODY) { reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

async function auth(handler, request, env, ctx, origin) {
  const body = await readJson(request);
  if (body === null) return json(400, origin, { code: 'BAD_REQUEST' });
  const done = await handler(body, env, { defer: ctx?.waitUntil ? promise => ctx.waitUntil(promise) : null });
  return new Response(JSON.stringify(done.body), { status: done.status,
    headers: { ...cors(origin), 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = origin && ALLOWED_ORIGINS.some(pattern => pattern.test(origin)) ? origin : null;

    const handler = Object.hasOwn(AUTH_ROUTES, url.pathname) ? AUTH_ROUTES[url.pathname] : null;
    if (handler) {
      if (request.method === 'OPTIONS') return reply(allowed ? 204 : 403, allowed);
      if (request.method !== 'POST') return reply(405, allowed);
      if (!allowed) return reply(403, null);
      return auth(handler, request, env, ctx, allowed);
    }

    if (url.pathname === '/rooms') {
      if (request.method === 'OPTIONS') return reply(allowed ? 204 : 403, allowed);
      if (request.method !== 'POST') return reply(405, allowed);
      if (!allowed) return reply(403, null);
      return createRoom(env, allowed);
    }

    const socket = /^\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    if (socket) {
      if (request.method !== 'GET') return reply(405, allowed);
      if (!allowed) return reply(403, null);
      if (!keyOk(env)) return reply(500, allowed);
      let typed;
      try { typed = decodeURIComponent(socket[1]); } catch { return reply(404, allowed); }
      const parsed = await parseRoomCode(typed, env.ROOM_CODE_KEY);
      if (!parsed.ok) return reply(404, allowed);
      // A page that could not open the socket asks with a plain GET: 404 means the code is wrong, 426 means the code is fine.
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return reply(426, allowed);
      return roomOf(env, parsed.body).fetch(request);
    }

    return reply(404, allowed);
  }
};
