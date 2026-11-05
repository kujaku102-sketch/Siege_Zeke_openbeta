// The online door: hands out room codes and passes a WebSocket to the room it names.
// It does no game work. A code whose check characters are wrong is refused here, before any room is woken.
import { createRoomCode, formatRoomCode, parseRoomCode, randomRoomBody } from '../../../src/network/room-code.js';


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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = origin && ALLOWED_ORIGINS.some(pattern => pattern.test(origin)) ? origin : null;

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
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return reply(426, allowed);
      if (!keyOk(env)) return reply(500, allowed);
      let typed;
      try { typed = decodeURIComponent(socket[1]); } catch { return reply(404, allowed); }
      const parsed = await parseRoomCode(typed, env.ROOM_CODE_KEY);
      if (!parsed.ok) return reply(404, allowed);
      return roomOf(env, parsed.body).fetch(request);
    }

    return reply(404, allowed);
  }
};
