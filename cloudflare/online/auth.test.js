// /auth/discord/start and /auth/discord/exchange through the Worker, with a fake Discord on this PC (a plain HTTP server).
// Nothing here reaches the real Discord, and every key and secret is a test value.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import worker from './src/router.js';
import { authConfig } from './src/auth.js';
import { verifyTicket, verifyState, pkceChallenge, pkceVerifier } from '../../src/network/discord-auth.js';
import { sha256Hex } from '../../src/network/room-code.js';

const SITE = 'https://siegezeke.online';
const CLIENT_ID = '123456789012345678';
const CLIENT_SECRET = 'test-only-client-secret-abc';
const AUTH_KEY = 'test-only-auth-key-0123456789abcdef';
const REDIRECT = 'https://siegezeke.online/discord-callback.html';
const TOKEN = '0123456789abcdef0123456789abcdef';
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210';
const USER = { id: '80351110224678912', username: 'yuuki_01', global_name: 'ゆうき', avatar: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', discriminator: '0',
  email: 'a@example.com', verified: true, locale: 'ja' };

// A fake Discord: records what it is asked and answers from `plan`.
async function fakeDiscord(plan = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const call = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
      seen.push(call);
      const route = `${req.method} ${req.url}`;
      const answer = plan[route] ? plan[route](call) : defaultAnswer(route);
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body ?? {}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { seen, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
const defaultAnswer = route => route === 'POST /api/oauth2/token' ? { status: 200, body: { access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'Bearer', expires_in: 604800, scope: 'identify' } }
  : route === 'GET /api/v10/users/@me' ? { status: 200, body: USER }
  : route === 'POST /api/oauth2/token/revoke' ? { status: 200, body: {} } : { status: 404, body: {} };

const envFor = discord => ({ DISCORD_BASE: discord.base, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET: CLIENT_SECRET, DISCORD_REDIRECT_URI: REDIRECT, AUTH_KEY });
const post = (path, body, { env, origin = SITE, ctx, raw } = {}) => worker.fetch(new Request(`https://play.siegezeke.online${path}`,
  { method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }), env, ctx);
const start = (env, token = TOKEN, extra) => post('/auth/discord/start', { token }, { env, ...extra });
const exchange = (env, body, extra) => post('/auth/discord/exchange', body, { env, ...extra });

async function login(env, token = TOKEN) {
  const started = await (await start(env, token)).json();
  return { started, state: started.state };
}

test('start gives an address for Discord that asks for identify only, with a signed state and an S256 challenge', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    const response = await start(env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), SITE);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { url, state, expiresAt } = await response.json();
    const asked = new URL(url);
    assert.equal(`${asked.origin}${asked.pathname}`, `${discord.base}/oauth2/authorize`);
    assert.deepEqual(Object.fromEntries(asked.searchParams), { response_type: 'code', client_id: CLIENT_ID, scope: 'identify', state, redirect_uri: REDIRECT,
      code_challenge: await pkceChallenge(await pkceVerifier(AUTH_KEY, state)), code_challenge_method: 'S256' });
    assert.ok(expiresAt > Date.now() && expiresAt <= Date.now() + 10 * 60 * 1000);
    assert.equal((await verifyState(state, { secret: AUTH_KEY, tokenHash: await sha256Hex(TOKEN) })).ok, true);
    assert.equal((await verifyState(state, { secret: AUTH_KEY, tokenHash: await sha256Hex(OTHER_TOKEN) })).ok, false);
    assert.equal(discord.seen.length, 0, 'start does not call Discord');
    assert.ok(!JSON.stringify(await (await start(env)).json()).includes(CLIENT_SECRET));
  } finally { await discord.close(); }
});

test('the whole login: code in, ticket out; the token is used once and given back; the secret goes only to Discord', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    const { state } = await login(env);
    const deferred = [];
    const response = await exchange(env, { code: 'the-code', state, token: TOKEN, iss: discord.base }, { ctx: { waitUntil: promise => deferred.push(promise) } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { ticket, profile } = await response.json();
    await Promise.all(deferred);
    assert.deepEqual(profile, { name: 'ゆうき', avatarUrl: `https://cdn.discordapp.com/avatars/${USER.id}/${USER.avatar}.png?size=128`, expiresAt: profile.expiresAt });
    assert.ok(profile.expiresAt > Date.now() + 29 * 24 * 3600 * 1000);
    assert.equal((await verifyTicket(ticket, { secret: AUTH_KEY, tokenHash: await sha256Hex(TOKEN) })).ok, true);
    assert.equal((await verifyTicket(ticket, { secret: AUTH_KEY, tokenHash: await sha256Hex(OTHER_TOKEN) })).error.code, 'TICKET_MISMATCH');

    assert.deepEqual(discord.seen.map(call => `${call.method} ${call.path}`), ['POST /api/oauth2/token', 'GET /api/v10/users/@me', 'POST /api/oauth2/token/revoke']);
    const [tokenCall, meCall, revokeCall] = discord.seen;
    const form = Object.fromEntries(new URLSearchParams(tokenCall.body));
    assert.deepEqual(form, { grant_type: 'authorization_code', code: 'the-code', redirect_uri: REDIRECT, code_verifier: await pkceVerifier(AUTH_KEY, state) });
    assert.equal(tokenCall.headers.authorization, `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`);
    assert.equal(tokenCall.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.match(tokenCall.headers['user-agent'], /^DiscordBot \(https:\/\/siegezeke\.online, /);
    assert.equal(meCall.headers.authorization, 'Bearer test-access-token');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(revokeCall.body)), { token: 'test-access-token', token_type_hint: 'access_token' });

    const everything = JSON.stringify([ticket, profile]);
    for (const secret of [CLIENT_SECRET, AUTH_KEY, 'test-access-token', 'test-refresh-token', 'a@example.com', 'yuuki_01', TOKEN]) {
      assert.ok(!everything.includes(secret), `${secret} must not be in the answer`);
    }
  } finally { await discord.close(); }
});

test('without a waitUntil the revoke is finished before the answer', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    const { state } = await login(env);
    assert.equal((await exchange(env, { code: 'c', state, token: TOKEN })).status, 200);
    assert.equal(discord.seen.at(-1).path, '/api/oauth2/token/revoke');
  } finally { await discord.close(); }
});

test('a user with no avatar and no display name gets the default picture and the username', async () => {
  const discord = await fakeDiscord({ 'GET /api/v10/users/@me': () => ({ status: 200, body: { id: '175928847299117063', username: 'plain_user', global_name: null, avatar: null, discriminator: '0' } }) });
  try {
    const env = envFor(discord);
    const { state } = await login(env);
    const { profile } = await (await exchange(env, { code: 'c', state, token: TOKEN })).json();
    assert.equal(profile.name, 'plain_user');
    assert.equal(profile.avatarUrl, 'https://cdn.discordapp.com/embed/avatars/2.png');
  } finally { await discord.close(); }
});

test('an unfinished setting is SERVER_MISCONFIGURED, and Discord is never called', async () => {
  const discord = await fakeDiscord();
  try {
    const good = envFor(discord);
    const broken = [{ ...good, DISCORD_CLIENT_SECRET: undefined }, { ...good, AUTH_KEY: undefined }, { ...good, AUTH_KEY: 'short' }, { ...good, DISCORD_CLIENT_ID: undefined },
      { ...good, DISCORD_CLIENT_ID: 'abc' }, { ...good, DISCORD_REDIRECT_URI: undefined }, { ...good, DISCORD_REDIRECT_URI: 'not a url' },
      { ...good, DISCORD_REDIRECT_URI: 'http://evil.example/cb' }, { ...good, DISCORD_BASE: 'https://evil.example' }, {}];
    for (const env of broken) {
      for (const response of [await start(env), await exchange(env, { code: 'c', state: 's', token: TOKEN })]) {
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { code: 'SERVER_MISCONFIGURED' });
      }
    }
    assert.equal(discord.seen.length, 0);
    assert.equal(authConfig(good) !== null, true);
    assert.equal(authConfig({ ...good, DISCORD_REDIRECT_URI: 'http://127.0.0.1:5173/discord-callback.html' }) !== null, true, 'a local page may be a redirect');
  } finally { await discord.close(); }
});

test('rooms and guests work with no Discord setting at all', async () => {
  const rooms = { idFromName: name => name, get: () => ({ fetch: async () => new Response(null, { status: 201 }) }) };
  const env = { ROOM: rooms, ROOM_CODE_KEY: 'test-only-room-key-0123456789' };
  const made = await worker.fetch(new Request('https://play.siegezeke.online/rooms', { method: 'POST', headers: { origin: SITE } }), env);
  assert.equal(made.status, 201);
  assert.equal((await start(env)).status, 500);
});

test('a bad request is refused before Discord is asked', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    const { state } = await login(env);
    const { state: foreignState } = await login(env, OTHER_TOKEN);
    const cases = [
      [{ code: 'c', state, token: OTHER_TOKEN }, 400, 'AUTH_STATE_INVALID'],            // another browser
      [{ code: 'c', state: foreignState, token: TOKEN }, 400, 'AUTH_STATE_INVALID'],
      [{ code: 'c', state: `${state}x`, token: TOKEN }, 400, 'AUTH_STATE_INVALID'],
      [{ code: 'c', state: 'garbage', token: TOKEN }, 400, 'AUTH_STATE_INVALID'],
      [{ code: 'c', state, token: TOKEN, iss: 'https://evil.example' }, 400, 'BAD_REQUEST'],
      [{ state, token: TOKEN }, 400, 'BAD_REQUEST'],
      [{ code: '', state, token: TOKEN }, 400, 'BAD_REQUEST'],
      [{ code: 'has space', state, token: TOKEN }, 400, 'BAD_REQUEST'],
      [{ code: 'x'.repeat(300), state, token: TOKEN }, 400, 'BAD_REQUEST'],
      [{ code: 'c', token: TOKEN }, 400, 'BAD_REQUEST'],
      [{ code: 'c', state, token: 'short' }, 400, 'BAD_REQUEST'],
      [{ code: 5, state, token: TOKEN }, 400, 'BAD_REQUEST'],
      [{}, 400, 'BAD_REQUEST']
    ];
    for (const [body, status, code] of cases) {
      const response = await exchange(env, body);
      assert.equal(response.status, status, JSON.stringify(body).slice(0, 80));
      assert.deepEqual(await response.json(), { code }, JSON.stringify(body).slice(0, 80));
    }
    for (const token of ['short', 5, null, 'g'.repeat(32)]) assert.equal((await start(env, token)).status, 400, String(token));
    assert.equal(discord.seen.length, 0, 'Discord was not called for any of these');
  } finally { await discord.close(); }
});

test('a state older than ten minutes is expired', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    const { state } = await login(env);
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 60 * 1000 + 2000;
    try {
      const response = await exchange(env, { code: 'c', state, token: TOKEN });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { code: 'AUTH_STATE_EXPIRED' });
    } finally { Date.now = realNow; }
    assert.equal(discord.seen.length, 0);
  } finally { await discord.close(); }
});

test('what Discord says is mapped to a short code, and its words are not passed on', async () => {
  const cases = [[400, 'AUTH_CODE_INVALID', 400], [401, 'SERVER_MISCONFIGURED', 500], [429, 'DISCORD_UNREACHABLE', 503], [500, 'DISCORD_UNREACHABLE', 503]];
  for (const [discordStatus, code, status] of cases) {
    const discord = await fakeDiscord({ 'POST /api/oauth2/token': () => ({ status: discordStatus, body: { error: 'invalid_grant', error_description: 'secret detail' } }) });
    try {
      const env = envFor(discord);
      const { state } = await login(env);
      const response = await exchange(env, { code: 'c', state, token: TOKEN });
      assert.equal(response.status, status, String(discordStatus));
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { code });
      assert.ok(!text.includes('secret detail'));
      assert.equal(discord.seen.length, 1);
    } finally { await discord.close(); }
  }
  const noUser = await fakeDiscord({ 'GET /api/v10/users/@me': () => ({ status: 200, body: { id: 'not-a-number', username: 'x' } }) });
  try {
    const env = envFor(noUser);
    const { state } = await login(env);
    const response = await exchange(env, { code: 'c', state, token: TOKEN });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'DISCORD_BAD_REPLY' });
    assert.equal(noUser.seen.at(-1).path, '/api/oauth2/token/revoke', 'the token was still given back');
  } finally { await noUser.close(); }
  // A Discord that is not there at all.
  const gone = await fakeDiscord();
  const env = envFor(gone);
  const { state } = await login(env);
  await gone.close();
  const response = await exchange(env, { code: 'c', state, token: TOKEN });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'DISCORD_UNREACHABLE' });
});

test('only pages of the site may log in; the preflight says so; only POST works', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    for (const path of ['/auth/discord/start', '/auth/discord/exchange']) {
      for (const origin of ['https://evil.example', 'https://other-project.pages.dev', null]) {
        const refused = await post(path, { token: TOKEN }, { env, origin });
        assert.equal(refused.status, 403, `${path} ${origin}`);
        assert.equal(refused.headers.get('access-control-allow-origin'), null);
      }
      const preflight = await worker.fetch(new Request(`https://play.siegezeke.online${path}`, { method: 'OPTIONS', headers: { origin: SITE } }), env);
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);
      assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
      assert.equal((await worker.fetch(new Request(`https://play.siegezeke.online${path}`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env)).status, 403);
      assert.equal((await worker.fetch(new Request(`https://play.siegezeke.online${path}`, { headers: { origin: SITE } }), env)).status, 405);
    }
    assert.equal((await start(env, TOKEN, { origin: 'http://localhost:5173' })).status, 200, 'a page on this PC may log in');
    assert.equal(discord.seen.length, 0);
  } finally { await discord.close(); }
});

test('the body is small JSON: a big one, a broken one or a non-object is a 400', async () => {
  const discord = await fakeDiscord();
  try {
    const env = envFor(discord);
    for (const raw of ['{broken', '', '[]', '"text"', 'null', JSON.stringify({ token: TOKEN, junk: 'x'.repeat(5000) })]) {
      const response = await post('/auth/discord/start', null, { env, raw });
      assert.equal(response.status, 400, raw.slice(0, 30));
      assert.deepEqual(await response.json(), { code: 'BAD_REQUEST' });
    }
    const declared = await worker.fetch(new Request('https://play.siegezeke.online/auth/discord/start', { method: 'POST',
      headers: { origin: SITE, 'content-length': '999999' }, body: JSON.stringify({ token: TOKEN }) }), env);
    assert.equal(declared.status, 400);
  } finally { await discord.close(); }
});

test('the paths the Worker already had still work beside the new ones', async () => {
  const env = { ROOM_CODE_KEY: 'test-only-room-key-0123456789' };
  for (const path of ['/auth', '/auth/discord', '/auth/discord/other', '/auth/discord/start/x', '/__proto__', '/constructor']) {
    assert.equal((await worker.fetch(new Request(`https://play.siegezeke.online${path}`, { method: 'POST', headers: { origin: SITE } }), env)).status, 404, path);
  }
});
