// The page's side of the Discord login (src/network/discord-login.js), with a fake server, fake storage and a fake address bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordLogin, PROFILE_KEY, STATE_KEY } from '../src/network/discord-login.js';
import { AUTH_LIMITS } from '../src/network/discord-auth.js';
import { TOKEN_KEY } from '../src/network/guest-token.js';

const ENDPOINT = 'https://play.siegezeke.online';
const NOW = Date.UTC(2026, 10, 5, 12);
const AVATAR_URL = 'https://cdn.discordapp.com/avatars/80351110224678912/a1b2c3d4e5f60718293a4b5c6d7e8f90.png?size=128';
const TICKET = `v1.${'A'.repeat(300)}.${'B'.repeat(43)}`;

function memory() {
  const map = new Map();
  return { map, getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => { map.set(key, String(value)); }, removeItem: key => { map.delete(key); } };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function page({ answers = {}, storage = memory(), session = memory(), clock = { at: NOW }, withSession = true } = {}) {
  const asked = [];
  const visited = [];
  const fetchImpl = async (url, init) => {
    const step = new URL(url).pathname.split('/').pop();
    asked.push({ url, step, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    if (answers[step]) return answers[step](asked.at(-1));
    if (step === 'start') return json(200, { url: 'https://discord.com/oauth2/authorize?state=SERVER-STATE', state: 'SERVER-STATE', expiresAt: clock.at + AUTH_LIMITS.stateMs });
    return json(200, { ticket: TICKET, profile: { name: 'ゆうき', avatarUrl: AVATAR_URL, expiresAt: clock.at + AUTH_LIMITS.ticketMs } });
  };
  const login = createDiscordLogin({ endpoint: ENDPOINT, storage, session: withSession ? session : null, fetchImpl, navigate: url => visited.push(url), now: () => clock.at,
    randomBytes: count => new Uint8Array(count).fill(7) });
  return { login, asked, visited, storage, session, clock };
}

test('start asks the server with this browser\'s token, keeps the state for the trip, and sends the page to Discord', async () => {
  const p = page();
  const result = await p.login.start();
  assert.deepEqual(result, { ok: true, url: 'https://discord.com/oauth2/authorize?state=SERVER-STATE' });
  assert.equal(p.asked.length, 1);
  assert.equal(p.asked[0].url, `${ENDPOINT}/auth/discord/start`);
  assert.equal(p.asked[0].method, 'POST');
  assert.equal(p.asked[0].headers['content-type'], 'application/json');
  assert.equal(p.asked[0].body.token, p.storage.getItem(TOKEN_KEY), 'the browser token goes in the body, never in an address');
  assert.deepEqual(Object.keys(p.asked[0].body), ['token']);
  assert.ok(!p.asked[0].url.includes(p.asked[0].body.token));
  assert.deepEqual(p.visited, ['https://discord.com/oauth2/authorize?state=SERVER-STATE']);
  assert.deepEqual(JSON.parse(p.session.getItem(STATE_KEY)), { state: 'SERVER-STATE', at: NOW });
  assert.equal(p.storage.getItem(STATE_KEY), null, 'the trip is kept in the tab\'s session storage');
});

test('where session storage is blocked the trip is kept in the ordinary storage', async () => {
  const p = page({ withSession: false });
  assert.equal((await p.login.start()).ok, true);
  assert.equal(JSON.parse(p.storage.getItem(STATE_KEY)).state, 'SERVER-STATE');
});

test('start fails cleanly: no address, no answer, a refusal, a bad reply, or nowhere to keep the state', async () => {
  const none = createDiscordLogin({ endpoint: null, storage: memory() });
  assert.equal(none.available(), false);
  assert.deepEqual(await none.start(), { ok: false, error: { code: 'ONLINE_UNAVAILABLE' } });

  const down = page({ answers: { start: () => { throw new TypeError('network'); } } });
  assert.equal((await down.login.start()).error.code, 'SERVER_UNREACHABLE');
  assert.deepEqual(down.visited, []);

  for (const [status, body, code] of [[500, { code: 'SERVER_MISCONFIGURED' }, 'SERVER_MISCONFIGURED'], [403, null, 'FORBIDDEN'], [429, null, 'RATE_LIMITED'], [503, {}, 'DISCORD_UNREACHABLE'], [404, null, 'SERVER_UNREACHABLE']]) {
    const p = page({ answers: { start: () => json(status, body) } });
    assert.equal((await p.login.start()).error.code, code, String(status));
    assert.deepEqual(p.visited, []);
  }
  for (const reply of [{}, { url: 5, state: 's' }, { url: 'javascript:alert(1)', state: 's' }, { url: 'https://discord.com/x' }]) {
    const p = page({ answers: { start: () => json(200, reply) } });
    assert.equal((await p.login.start()).error.code, 'DISCORD_BAD_REPLY', JSON.stringify(reply));
    assert.deepEqual(p.visited, []);
  }
  const blocked = page({ session: { setItem() { throw new Error('blocked'); }, getItem: () => null, removeItem() {} } });
  assert.equal((await blocked.login.start()).error.code, 'STORAGE_UNAVAILABLE');
  assert.deepEqual(blocked.visited, [], 'without a place for the state the page does not leave');
});

test('coming back with the right state trades the code for a ticket and keeps the login', async () => {
  const p = page();
  await p.login.start();
  const search = '?code=abc123&state=SERVER-STATE&iss=https%3A%2F%2Fdiscord.com';
  assert.equal(p.login.isCallback(search), true);
  const result = await p.login.finish(search);
  assert.deepEqual(result, { ok: true, profile: { name: 'ゆうき', avatarUrl: AVATAR_URL, expiresAt: NOW + AUTH_LIMITS.ticketMs } });
  const exchange = p.asked.at(-1);
  assert.equal(exchange.url, `${ENDPOINT}/auth/discord/exchange`);
  assert.deepEqual(exchange.body, { code: 'abc123', state: 'SERVER-STATE', token: p.storage.getItem(TOKEN_KEY), iss: 'https://discord.com' });
  assert.equal(p.session.getItem(STATE_KEY), null, 'the trip\'s state is used once');
  assert.deepEqual(p.login.profile(), { name: 'ゆうき', avatarUrl: AVATAR_URL, expiresAt: NOW + AUTH_LIMITS.ticketMs });
  assert.equal(p.login.ticket(), TICKET);
  assert.ok(!JSON.stringify(p.login.profile()).includes('v1.'), 'the profile for a screen does not carry the ticket');
  assert.deepEqual(Object.keys(JSON.parse(p.storage.getItem(PROFILE_KEY))).sort(), ['avatarUrl', 'expiresAt', 'name', 'ticket']);
});

test('a return that does not match the way out is refused without asking the server', async () => {
  const p = page();
  await p.login.start();
  const asked = p.asked.length;
  assert.equal((await p.login.finish('?code=abc&state=OTHER')).error.code, 'AUTH_STATE_INVALID');
  assert.equal(p.asked.length, asked, 'the server was not asked');
  assert.equal(p.session.getItem(STATE_KEY), null, 'a mismatch spends the trip too');
  assert.equal((await p.login.finish('?code=abc&state=SERVER-STATE')).error.code, 'AUTH_STATE_INVALID', 'so a second try with the right state fails');
  assert.equal(p.login.profile(), null);

  const fresh = page();
  assert.equal((await fresh.login.finish('?code=abc&state=SERVER-STATE')).error.code, 'AUTH_STATE_INVALID', 'no trip at all');
  assert.equal(fresh.asked.length, 0);
});

test('more than ten minutes on Discord\'s screen is a timeout', async () => {
  const p = page();
  await p.login.start();
  p.clock.at += AUTH_LIMITS.stateMs + 1;
  assert.equal((await p.login.finish('?code=abc&state=SERVER-STATE')).error.code, 'AUTH_STATE_EXPIRED');
  assert.equal(p.asked.length, 1);
});

test('saying no on Discord\'s screen, or another error, is told apart and keeps the guest as they were', async () => {
  const p = page();
  await p.login.start();
  assert.equal((await p.login.finish('?error=access_denied&error_description=The+resource+owner+denied&state=SERVER-STATE')).error.code, 'DISCORD_DENIED');
  assert.equal(p.asked.length, 1, 'nothing to exchange');
  await p.login.start();
  assert.equal((await p.login.finish('?error=server_error&state=SERVER-STATE')).error.code, 'DISCORD_ERROR');
  assert.equal(p.login.profile(), null);
  assert.equal(p.login.ticket(), null);
});

test('what the server answers on exchange is passed on as a code, and nothing is saved', async () => {
  for (const [status, body, code] of [[400, { code: 'AUTH_CODE_INVALID' }, 'AUTH_CODE_INVALID'], [400, { code: 'AUTH_STATE_EXPIRED' }, 'AUTH_STATE_EXPIRED'], [500, { code: 'SERVER_MISCONFIGURED' }, 'SERVER_MISCONFIGURED'],
    [503, { code: 'DISCORD_UNREACHABLE' }, 'DISCORD_UNREACHABLE'], [429, null, 'RATE_LIMITED'], [403, null, 'FORBIDDEN'], [400, { code: 'lower case' }, 'SERVER_UNREACHABLE']]) {
    const p = page({ answers: { exchange: () => json(status, body) } });
    await p.login.start();
    assert.equal((await p.login.finish('?code=abc&state=SERVER-STATE')).error.code, code, `${status} ${JSON.stringify(body)}`);
    assert.equal(p.storage.getItem(PROFILE_KEY), null);
  }
  const lost = page({ answers: { exchange: () => { throw new TypeError('network'); } } });
  await lost.login.start();
  assert.equal((await lost.login.finish('?code=abc&state=SERVER-STATE')).error.code, 'SERVER_UNREACHABLE');
  for (const reply of [{}, { ticket: '', profile: { name: 'x', avatarUrl: AVATAR_URL, expiresAt: NOW } }, { ticket: TICKET, profile: { name: 'x', avatarUrl: 'https://evil.example/a.png', expiresAt: NOW } },
    { ticket: TICKET, profile: { name: 5, avatarUrl: AVATAR_URL, expiresAt: NOW } }, { ticket: TICKET, profile: { name: 'x', avatarUrl: AVATAR_URL } }, { ticket: 'x'.repeat(2000), profile: { name: 'x', avatarUrl: AVATAR_URL, expiresAt: NOW } }]) {
    const p = page({ answers: { exchange: () => json(200, reply) } });
    await p.login.start();
    assert.equal((await p.login.finish('?code=abc&state=SERVER-STATE')).error.code, 'DISCORD_BAD_REPLY', JSON.stringify(reply).slice(0, 80));
    assert.equal(p.storage.getItem(PROFILE_KEY), null);
  }
});

test('an address that is not a Discord return is left alone', async () => {
  const p = page();
  for (const search of ['', '?online=http://127.0.0.1:8801', '?code=abc', '?state=x', null, undefined]) {
    assert.equal(p.login.isCallback(search), false, String(search));
    assert.deepEqual(await p.login.finish(search), { ok: false, error: { code: 'NOT_A_CALLBACK' }, ignored: true });
  }
  assert.equal(p.asked.length, 0);
});

test('the login lasts thirty days, then reads as no login; log out forgets it at once', async () => {
  const p = page();
  await p.login.start();
  await p.login.finish('?code=abc&state=SERVER-STATE');
  p.clock.at = NOW + AUTH_LIMITS.ticketMs;
  assert.equal(p.login.profile().name, 'ゆうき');
  p.clock.at = NOW + AUTH_LIMITS.ticketMs + 1;
  assert.equal(p.login.profile(), null);
  assert.equal(p.login.ticket(), null);
  assert.equal(p.storage.getItem(PROFILE_KEY), null, 'the old one is dropped when found');

  p.clock.at = NOW;
  await p.login.start();
  await p.login.finish('?code=abc&state=SERVER-STATE');
  assert.ok(p.login.ticket());
  p.login.logout();
  assert.equal(p.login.profile(), null);
  assert.equal(p.storage.getItem(PROFILE_KEY), null);
  assert.equal(p.storage.getItem(TOKEN_KEY).length, 32, 'the browser token is not touched');
});

test('a saved login that was edited or damaged reads as no login', async () => {
  const good = { ticket: TICKET, name: 'ゆうき', avatarUrl: AVATAR_URL, expiresAt: NOW + 1000 };
  const p = page();
  p.storage.setItem(PROFILE_KEY, JSON.stringify(good));
  assert.equal(p.login.profile().name, 'ゆうき');
  for (const bad of ['not json', '[]', 'null', JSON.stringify({ ...good, avatarUrl: 'https://evil.example/a.png' }), JSON.stringify({ ...good, ticket: '' }), JSON.stringify({ ...good, ticket: 'x'.repeat(2000) }),
    JSON.stringify({ ...good, name: 5 }), JSON.stringify({ ...good, expiresAt: 'later' })]) {
    p.storage.setItem(PROFILE_KEY, bad);
    assert.equal(p.login.profile(), null, bad.slice(0, 40));
    assert.equal(p.login.ticket(), null);
  }
  const blocked = createDiscordLogin({ endpoint: ENDPOINT, storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  assert.equal(blocked.profile(), null);
  assert.equal(blocked.ticket(), null);
  blocked.logout();
});

test('the methods can be handed around on their own', async () => {
  const p = page();
  const { start, finish, profile, logout, isCallback, available } = p.login;
  assert.equal(available(), true);
  assert.equal((await start()).ok, true);
  assert.equal(isCallback('?code=a&state=b'), true);
  assert.equal((await finish('?code=abc&state=SERVER-STATE')).ok, true);
  assert.equal(profile().name, 'ゆうき');
  logout();
  assert.equal(profile(), null);
});
