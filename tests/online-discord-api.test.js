// The calls to Discord for one login, answered by a fake Discord (src/network/discord-api.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCORD_USER_AGENT, discordBaseOf, discordEndpoints, fetchDiscordUser } from '../src/network/discord-api.js';

// Test-only values.
const CLIENT_ID = '123456789012345678';
const CLIENT_SECRET = 'test-only-client-secret-abc';
const ENDPOINTS = discordEndpoints();
const REPLY_USER = { id: '80351110224678912', username: 'yuuki_01', global_name: 'ゆうき', avatar: null, discriminator: '0' };

const respond = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A fake Discord: records every request and answers by address; `plan` can change an answer.
function fakeDiscord(plan = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url, method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])), body: init.body ?? null };
    calls.push(call);
    const key = url === ENDPOINTS.token ? 'token' : url === ENDPOINTS.me ? 'me' : url === ENDPOINTS.revoke ? 'revoke' : 'other';
    if (plan[key]) return plan[key](call);
    if (key === 'token') return respond(200, { access_token: 'test-access-token', token_type: 'Bearer', expires_in: 604800, refresh_token: 'test-refresh-token', scope: 'identify' });
    if (key === 'me') return respond(200, REPLY_USER);
    if (key === 'revoke') return respond(200, {});
    return respond(404, {});
  };
  return { calls, fetchImpl };
}
const run = (fetchImpl, extra = {}) => fetchDiscordUser({ fetchImpl, endpoints: ENDPOINTS, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
  redirectUri: 'https://siegezeke.online/discord-callback.html', code: 'the-code', verifier: 'the-verifier', ...extra });

test('one login is three calls: the code for a token, who it is, and the token given back', async () => {
  const fake = fakeDiscord();
  const result = await run(fake.fetchImpl);
  assert.deepEqual(result, { ok: true, user: REPLY_USER });
  assert.deepEqual(fake.calls.map(call => `${call.method} ${call.url}`), [
    'POST https://discord.com/api/oauth2/token', 'GET https://discord.com/api/v10/users/@me', 'POST https://discord.com/api/oauth2/token/revoke']);

  const [token, me, revoke] = fake.calls;
  assert.equal(token.headers['content-type'], 'application/x-www-form-urlencoded', 'Discord accepts no JSON here');
  assert.equal(token.headers.authorization, `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`);
  assert.equal(token.headers['user-agent'], DISCORD_USER_AGENT);
  assert.match(DISCORD_USER_AGENT, /^DiscordBot \(https:\/\/siegezeke\.online, [\d.]+\)$/);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), { grant_type: 'authorization_code', code: 'the-code',
    redirect_uri: 'https://siegezeke.online/discord-callback.html', code_verifier: 'the-verifier' });
  assert.ok(!token.body.includes(CLIENT_SECRET), 'the secret travels in the header only');

  assert.equal(me.headers.authorization, 'Bearer test-access-token');
  assert.equal(me.headers['user-agent'], DISCORD_USER_AGENT);
  assert.equal(revoke.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(revoke.body)), { token: 'test-access-token', token_type_hint: 'access_token' });
});

test('the refresh token is never used or kept, and nothing but the user comes back', async () => {
  const fake = fakeDiscord();
  const result = await run(fake.fetchImpl);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'user']);
  assert.ok(!JSON.stringify(result).includes('test-access-token') && !JSON.stringify(result).includes('refresh'));
  assert.ok(!fake.calls.some(call => call.body?.includes('refresh_token')));
});

test('a code Discord rejects, a client Discord rejects, and a Discord that is down are told apart', async () => {
  const cases = [[400, 'AUTH_CODE_INVALID'], [401, 'SERVER_MISCONFIGURED'], [429, 'DISCORD_UNREACHABLE'], [500, 'DISCORD_UNREACHABLE'], [503, 'DISCORD_UNREACHABLE'], [403, 'DISCORD_UNREACHABLE']];
  for (const [status, code] of cases) {
    const fake = fakeDiscord({ token: () => respond(status, { error: 'x', error_description: 'secret detail' }) });
    const result = await run(fake.fetchImpl);
    assert.equal(result.ok, false, String(status));
    assert.equal(result.error.code, code, String(status));
    assert.ok(!JSON.stringify(result).includes('secret detail'), 'Discord\'s words are not passed on');
    assert.equal(fake.calls.length, 1, 'no token, so nothing else is called');
  }
  const down = await run(async () => { throw new TypeError('network'); });
  assert.deepEqual(down, { ok: false, error: { code: 'DISCORD_UNREACHABLE' } });
});

test('a token reply without a token, or not JSON, is a failure', async () => {
  for (const reply of [() => respond(200, {}), () => respond(200, { access_token: '' }), () => respond(200, { access_token: 5 }), () => new Response('<html>', { status: 200 })]) {
    const result = await run(fakeDiscord({ token: reply }).fetchImpl);
    assert.equal(result.error.code, 'DISCORD_UNREACHABLE');
  }
});

test('if the user cannot be read the token is still given back', async () => {
  for (const me of [() => respond(401, {}), () => respond(500, {}), () => respond(200, null), () => new Response('nope', { status: 200 }), () => { throw new TypeError('network'); }]) {
    const fake = fakeDiscord({ me });
    const result = await run(fake.fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'DISCORD_UNREACHABLE');
    assert.equal(fake.calls.at(-1).url, ENDPOINTS.revoke, 'revoked all the same');
  }
});

test('a failing revoke does not spoil the login, and a Worker can finish it after the reply', async () => {
  for (const revoke of [() => respond(500, {}), () => { throw new TypeError('network'); }]) {
    const result = await run(fakeDiscord({ revoke }).fetchImpl);
    assert.equal(result.ok, true);
  }
  const deferred = [];
  let revoked = false;
  const fake = fakeDiscord({ revoke: async () => { await new Promise(resolve => setTimeout(resolve, 20)); revoked = true; return respond(200, {}); } });
  const result = await run(fake.fetchImpl, { defer: promise => deferred.push(promise) });
  assert.equal(result.ok, true);
  assert.equal(revoked, false, 'the reply did not wait for it');
  assert.equal(deferred.length, 1);
  await Promise.all(deferred);
  assert.equal(revoked, true);
});

test('the Discord address is the real one, or a server on this PC; nothing else', () => {
  assert.equal(discordBaseOf(undefined), 'https://discord.com');
  assert.equal(discordBaseOf(''), 'https://discord.com');
  assert.equal(discordBaseOf('https://discord.com'), 'https://discord.com');
  assert.equal(discordBaseOf('http://127.0.0.1:8123'), 'http://127.0.0.1:8123');
  assert.equal(discordBaseOf('http://localhost:9000/x'), 'http://localhost:9000');
  for (const bad of ['http://discord.com', 'https://discord.com.evil.example', 'https://evil.example', 'http://evil.example', 'http://192.168.0.5:80', 'ftp://127.0.0.1', 'not a url', 5]) {
    assert.equal(discordBaseOf(bad), null, String(bad));
  }
  assert.deepEqual(discordEndpoints('http://127.0.0.1:9'), { issuer: 'http://127.0.0.1:9', authorize: 'http://127.0.0.1:9/oauth2/authorize', token: 'http://127.0.0.1:9/api/oauth2/token',
    revoke: 'http://127.0.0.1:9/api/oauth2/token/revoke', me: 'http://127.0.0.1:9/api/v10/users/@me' });
});
