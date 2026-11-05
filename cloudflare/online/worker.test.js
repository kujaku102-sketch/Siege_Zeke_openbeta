import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/router.js';
import { createRoomCode, parseRoomCode } from '../../src/network/room-code.js';

const KEY = 'test-only-room-key-0123456789';
const SITE = 'https://siegezeke.online';

// A room namespace that remembers what it was asked and answers like a room would.
function namespace(answer = () => new Response(null, { status: 201 })) {
  const asked = [];
  return { asked, idFromName: name => name, get: name => ({ fetch: async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    asked.push({ name, method: request.method, path: new URL(request.url).pathname, body: init?.body ?? null });
    return answer(request, name, asked.length);
  } }) };
}
const create = (env, origin = SITE) => worker.fetch(new Request('https://play.siegezeke.online/rooms', { method: 'POST', headers: origin ? { origin } : {} }), env);
const connect = (env, code, { origin = SITE, upgrade = 'websocket' } = {}) => worker.fetch(new Request(`https://play.siegezeke.online/rooms/${encodeURIComponent(code)}/ws`,
  { headers: { ...(origin ? { origin } : {}), ...(upgrade ? { upgrade } : {}) } }), env);

test('a room is made for a page of the site: a checked code comes back and the room is told to start', async () => {
  const rooms = namespace();
  const env = { ROOM: rooms, ROOM_CODE_KEY: KEY };
  const response = await create(env);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('access-control-allow-origin'), SITE);
  assert.equal(response.headers.get('content-type'), 'application/json');
  const { code, display } = await response.json();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(display, `${code.slice(0, 4)}-${code.slice(4)}`);
  assert.equal((await parseRoomCode(code, KEY)).ok, true, 'the code carries its check characters');
  assert.equal(rooms.asked.length, 1);
  assert.equal(rooms.asked[0].name, `room:${code.slice(0, 6)}`);
  assert.equal(rooms.asked[0].path, '/init');
  assert.deepEqual(JSON.parse(rooms.asked[0].body), { code });
  for (const origin of ['http://localhost:5173', 'https://cb50cf4c.siege-zeke-simple-public.pages.dev']) assert.equal((await create(env, origin)).status, 201, origin);
});

test('only pages of the site may make a room, and the preflight says so', async () => {
  const rooms = namespace();
  const env = { ROOM: rooms, ROOM_CODE_KEY: KEY };
  for (const origin of ['https://evil.example', 'https://other-project.pages.dev', null]) {
    const refused = await create(env, origin);
    assert.equal(refused.status, 403, String(origin));
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(rooms.asked.length, 0, 'no room was asked');
  const preflight = await worker.fetch(new Request('https://play.siegezeke.online/rooms', { method: 'OPTIONS', headers: { origin: SITE } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);
  assert.equal((await worker.fetch(new Request('https://play.siegezeke.online/rooms', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://play.siegezeke.online/rooms'), env)).status, 405);
});

test('a code that is taken is drawn again, a room that cannot start is a 503, and a missing key is a 500', async () => {
  let calls = 0;
  const taken = namespace(() => new Response(null, { status: ++calls < 3 ? 409 : 201 }));
  assert.equal((await create({ ROOM: taken, ROOM_CODE_KEY: KEY })).status, 201);
  assert.equal(taken.asked.length, 3);
  assert.equal(new Set(taken.asked.map(call => call.name)).size, 3, 'each try draws a new code');
  const always = namespace(() => new Response(null, { status: 409 }));
  assert.equal((await create({ ROOM: always, ROOM_CODE_KEY: KEY })).status, 503);
  assert.equal(always.asked.length, 3);
  const broken = namespace(() => new Response(null, { status: 500 }));
  assert.equal((await create({ ROOM: broken, ROOM_CODE_KEY: KEY })).status, 503);
  const unkeyed = namespace();
  const response = await create({ ROOM: unkeyed });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: 'SERVER_MISCONFIGURED' });
  assert.equal((await create({ ROOM: unkeyed, ROOM_CODE_KEY: 'short' })).status, 500);
  assert.equal(unkeyed.asked.length, 0);
});

test('a socket goes to the room its code names, however the code was typed', async () => {
  const rooms = namespace((request) => new Response(request.headers.get('upgrade'), { status: 200 }));
  const env = { ROOM: rooms, ROOM_CODE_KEY: KEY };
  const code = await createRoomCode('K7M2QX', KEY);
  for (const typed of [code, code.toLowerCase(), `${code.slice(0, 4)}-${code.slice(4)}`]) {
    const response = await connect(env, typed);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'websocket');
  }
  assert.deepEqual([...new Set(rooms.asked.map(call => call.name))], ['room:K7M2QX']);
  assert.equal(rooms.asked[0].method, 'GET');
});

test('a guessed code never wakes a room, and a socket needs the site and an upgrade', async () => {
  const rooms = namespace();
  const env = { ROOM: rooms, ROOM_CODE_KEY: KEY };
  const code = await createRoomCode('K7M2QX', KEY);
  const wrongCheck = code.slice(0, 6) + (code[6] === 'A' ? 'B' : 'A') + code[7];
  for (const bad of [wrongCheck, 'SHORT', '', 'ABCD-EFGH-IJ', '%E0%A4%A']) {
    assert.equal((await connect(env, bad)).status, 404, bad);
  }
  assert.equal((await connect(env, code, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await connect(env, code, { origin: null })).status, 403);
  assert.equal((await connect(env, code, { upgrade: null })).status, 426);
  assert.equal((await worker.fetch(new Request(`https://play.siegezeke.online/rooms/${code}/ws`, { method: 'POST', headers: { origin: SITE } }), env)).status, 405);
  assert.equal((await connect({ ROOM: rooms }, code)).status, 500, 'no key, no sockets');
  assert.equal(rooms.asked.length, 0, 'none of these reached a room');
});

test('anything else is not found', async () => {
  const rooms = namespace();
  const env = { ROOM: rooms, ROOM_CODE_KEY: KEY };
  for (const path of ['/', '/room', '/rooms/', '/rooms/ABCD2345', '/rooms/ABCD2345/ws/extra', '/match-logs']) {
    assert.equal((await worker.fetch(new Request(`https://play.siegezeke.online${path}`, { headers: { origin: SITE } }), env)).status, 404, path);
  }
  assert.equal(rooms.asked.length, 0);
});
