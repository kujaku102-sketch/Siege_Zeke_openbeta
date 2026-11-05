// Discord login, the parts that need no network: state, PKCE, names, avatar addresses, tickets (src/network/discord-auth.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_LIMITS, avatarUrl, buildAuthorizeUrl, createState, defaultAvatarIndex, fromBase64Url, isDiscordAvatarUrl, issueTicket,
  pickDisplayName, pkceChallenge, pkceVerifier, profileOfDiscordUser, toBase64Url, verifyState, verifyTicket
} from '../src/network/discord-auth.js';
import { sha256Hex } from '../src/network/room-code.js';

// Test-only values.
const SECRET = 'test-only-auth-key-0123456789abcdef';
const OTHER_SECRET = 'another-test-only-key-0123456789ab';
const NOW = Date.UTC(2026, 10, 5, 12);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ID = '80351110224678912';
const AVATAR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('base64url round-trips and refuses what is not base64url', () => {
  const bytes = Uint8Array.from([0, 251, 255, 62, 63, 1, 2]);
  assert.equal(toBase64Url(bytes), 'APv_Pj8BAg');
  assert.deepEqual([...fromBase64Url('APv_Pj8BAg')], [...bytes]);
  for (const bad of ['a', 'ab+c', 'ab=c', 'a b', null, 5]) assert.equal(fromBase64Url(bad), null, String(bad));
  assert.deepEqual([...fromBase64Url('')], []);
});

test('a state is signed for one browser and runs out after ten minutes', async () => {
  const { state, expiresAt } = await createState({ secret: SECRET, tokenHash: HASH_A, now: NOW });
  assert.match(state, /^[A-Za-z0-9_-]{22}\.\d{13}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(expiresAt, NOW + AUTH_LIMITS.stateMs);
  assert.equal(AUTH_LIMITS.stateMs, 10 * 60 * 1000);
  assert.equal((await verifyState(state, { secret: SECRET, tokenHash: HASH_A, now: NOW + 1000 })).ok, true);
  assert.equal((await verifyState(state, { secret: SECRET, tokenHash: HASH_A, now: expiresAt })).ok, true, 'still good at the last moment');
  assert.equal((await verifyState(state, { secret: SECRET, tokenHash: HASH_A, now: expiresAt + 1 })).error.code, 'AUTH_STATE_EXPIRED');
  assert.equal((await verifyState(state, { secret: SECRET, tokenHash: HASH_B, now: NOW })).error.code, 'AUTH_STATE_INVALID', 'another browser cannot finish it');
  assert.equal((await verifyState(state, { secret: OTHER_SECRET, tokenHash: HASH_A, now: NOW })).error.code, 'AUTH_STATE_INVALID');
  const [nonce, expires, mac] = state.split('.');
  for (const bad of [`${nonce}.${Number(expires) + 60000}.${mac}`, `${'A'.repeat(22)}.${expires}.${mac}`, `${nonce}.${expires}.${'A'.repeat(43)}`,
    `${nonce}.${expires}`, '', 'x'.repeat(200), null, undefined, 5]) {
    assert.equal((await verifyState(bad, { secret: SECRET, tokenHash: HASH_A, now: NOW })).error.code, 'AUTH_STATE_INVALID', String(bad).slice(0, 30));
  }
  const again = await createState({ secret: SECRET, tokenHash: HASH_A, now: NOW });
  assert.notEqual(again.state, state, 'every state is new');
});

test('an expired state is reported as expired only if the signature is genuine', async () => {
  const { state } = await createState({ secret: SECRET, tokenHash: HASH_A, now: NOW });
  const later = NOW + AUTH_LIMITS.stateMs + 5000;
  assert.equal((await verifyState(state, { secret: SECRET, tokenHash: HASH_A, now: later })).error.code, 'AUTH_STATE_EXPIRED');
  assert.equal((await verifyState(state, { secret: SECRET, tokenHash: HASH_B, now: later })).error.code, 'AUTH_STATE_INVALID');
});

test('PKCE: the challenge follows RFC 7636, and the verifier is rebuilt from the state without storing it', async () => {
  // The example in RFC 7636 appendix B.
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const { state } = await createState({ secret: SECRET, tokenHash: HASH_A, now: NOW });
  const verifier = await pkceVerifier(SECRET, state);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/, '43 to 128 unreserved characters');
  assert.equal(await pkceVerifier(SECRET, state), verifier);
  assert.notEqual(await pkceVerifier(OTHER_SECRET, state), verifier);
  assert.notEqual(await pkceVerifier(SECRET, `${state}x`), verifier);
  assert.match(await pkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/);
});

test('the authorization address asks for identify only, with state and an S256 challenge', () => {
  const url = new URL(buildAuthorizeUrl({ clientId: '123456789012345678', redirectUri: 'https://siegezeke.online/discord-callback.html', state: 'S', challenge: 'C' }));
  assert.equal(`${url.origin}${url.pathname}`, 'https://discord.com/oauth2/authorize');
  assert.deepEqual(Object.fromEntries(url.searchParams), { response_type: 'code', client_id: '123456789012345678', scope: 'identify',
    state: 'S', redirect_uri: 'https://siegezeke.online/discord-callback.html', code_challenge: 'C', code_challenge_method: 'S256' });
  assert.ok(!/email|guilds|connections/.test(url.search));
});

test('the name is the display name, else the username; cleaned and cut like a guest name', () => {
  assert.equal(pickDisplayName({ global_name: 'ゆうき', username: 'yuuki_01' }), 'ゆうき');
  assert.equal(pickDisplayName({ global_name: null, username: 'yuuki_01' }), 'yuuki_01');
  assert.equal(pickDisplayName({ global_name: '   ', username: 'yuuki_01' }), 'yuuki_01');
  assert.equal(pickDisplayName({ global_name: '\u0000​', username: 'yuuki_01' }), 'yuuki_01', 'nothing visible is the same as no name');
  assert.equal(pickDisplayName({ username: 'yuuki_01' }), 'yuuki_01');
  assert.equal(pickDisplayName({ global_name: ' Taro \n\t Suzuki ', username: 'x' }), 'Taro Suzuki');
  assert.equal([...pickDisplayName({ global_name: 'あ'.repeat(40), username: 'x' })].length, 16);
  assert.equal(pickDisplayName({ global_name: '🙂'.repeat(20), username: 'x' }), '🙂'.repeat(16), 'cut by characters, not UTF-16 units');
  assert.equal(pickDisplayName({ global_name: 5, username: 7 }), 'Discord');
  assert.equal(pickDisplayName({}), 'Discord');
  assert.equal(pickDisplayName(null), 'Discord');
});

test('the default picture follows Discord: (id >> 22) % 6, or discriminator % 5 for an old tag', () => {
  assert.equal(defaultAvatarIndex({ id: ID, discriminator: '0' }), 5);
  assert.equal(defaultAvatarIndex({ id: '175928847299117063' }), 2);
  assert.equal(defaultAvatarIndex({ id: '1234567890123456789', discriminator: '0' }), 1);
  assert.equal(defaultAvatarIndex({ id: ID, discriminator: '1234' }), 4);
  assert.equal(defaultAvatarIndex({ id: ID, discriminator: '0007' }), 2);
  assert.equal(defaultAvatarIndex({ id: ID, discriminator: '0000' }), 5, 'zero means the new system');
  assert.equal(defaultAvatarIndex({ id: ID, discriminator: 'abcd' }), 5);
});

test('an avatar address is built only in two shapes, and only from a well-formed id and hash', () => {
  assert.equal(avatarUrl({ id: ID, avatar: AVATAR, defaultIndex: 3 }), `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=128`);
  assert.equal(avatarUrl({ id: ID, avatar: `a_${AVATAR}`, defaultIndex: 3 }), `https://cdn.discordapp.com/avatars/${ID}/a_${AVATAR}.png?size=128`, 'an animated picture is asked for as a still png');
  assert.equal(avatarUrl({ id: ID, avatar: null, defaultIndex: 3 }), 'https://cdn.discordapp.com/embed/avatars/3.png');
  assert.equal(avatarUrl({ id: ID, avatar: 'nothex'.padEnd(32, 'z'), defaultIndex: 2 }), 'https://cdn.discordapp.com/embed/avatars/2.png', 'a bad hash falls back to the default picture');
  assert.equal(avatarUrl({ id: ID, avatar: null }), null);
  assert.equal(avatarUrl({ id: ID, avatar: null, defaultIndex: 6 }), null);
  for (const id of ['', '123', '1'.repeat(21), '../x', `${ID}/../..`, 'abc', null]) assert.equal(avatarUrl({ id, avatar: AVATAR, defaultIndex: 1 }), null, String(id));
});

test('only Discord\'s own still avatar addresses count as avatar addresses', () => {
  for (const good of [`https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=128`, `https://cdn.discordapp.com/avatars/${ID}/a_${AVATAR}.png?size=128`,
    'https://cdn.discordapp.com/embed/avatars/0.png', 'https://cdn.discordapp.com/embed/avatars/5.png']) assert.equal(isDiscordAvatarUrl(good), true, good);
  for (const bad of [`http://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=128`, `https://cdn.discordapp.com.evil.example/avatars/${ID}/${AVATAR}.png?size=128`,
    `https://evil.example/avatars/${ID}/${AVATAR}.png?size=128`, `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.gif?size=128`, `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png`,
    `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=4096`, `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=128&x=1`,
    `https://cdn.discordapp.com/avatars/${ID}/../../x.png?size=128`, 'https://cdn.discordapp.com/embed/avatars/6.png', 'https://cdn.discordapp.com/embed/avatars/a.png',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', '//cdn.discordapp.com/embed/avatars/1.png', '', null, undefined, 5, {}, 'https://cdn.discordapp.com/embed/avatars/1.png\n']) {
    assert.equal(isDiscordAvatarUrl(bad), false, String(bad));
  }
});

test('only four fields of the Discord reply are used; anything else is dropped', () => {
  const reply = { id: ID, username: 'yuuki_01', global_name: 'ゆうき', avatar: AVATAR, discriminator: '0', email: 'a@example.com', banner: 'x', accent_color: 5, locale: 'ja',
    mfa_enabled: true, verified: true, public_flags: 64, avatar_decoration_data: { asset: 'a' } };
  const found = profileOfDiscordUser(reply);
  assert.deepEqual(found, { ok: true, value: { id: ID, name: 'ゆうき', avatar: AVATAR, defaultIndex: 5 } });
  assert.ok(!JSON.stringify(found).includes('example.com'));
  assert.deepEqual(profileOfDiscordUser({ id: ID, username: 'u', avatar: null, discriminator: '0' }).value.avatar, null);
  assert.equal(profileOfDiscordUser({ id: ID, username: 'u', avatar: 'zz' }).value.avatar, null, 'a hash of the wrong shape is no avatar');
  for (const bad of [null, undefined, 5, 'x', {}, { id: 'abc' }, { id: 123, username: 'x' }, { id: `${ID}9999`, username: 'x' }]) {
    assert.equal(profileOfDiscordUser(bad).error?.code, 'DISCORD_BAD_REPLY', JSON.stringify(bad));
  }
});

test('a ticket carries name, id and avatar for one browser, and is good for thirty days', async () => {
  const profile = profileOfDiscordUser({ id: ID, username: 'yuuki_01', global_name: 'ゆうき', avatar: AVATAR, discriminator: '0', email: 'a@example.com' }).value;
  const { ticket, expiresAt } = await issueTicket({ secret: SECRET, tokenHash: HASH_A, profile, now: NOW });
  assert.match(ticket, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.ok(ticket.length < 600, `short enough for a hello (${ticket.length})`);
  assert.equal(expiresAt, NOW + 30 * 24 * 60 * 60 * 1000);
  assert.equal(AUTH_LIMITS.ticketMs, 30 * 24 * 60 * 60 * 1000);
  const ok = await verifyTicket(ticket, { secret: SECRET, tokenHash: HASH_A, now: NOW + 1000 });
  assert.deepEqual(ok, { ok: true, value: { name: 'ゆうき', avatarUrl: `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=128`, expiresAt } });
  // The body is readable by anyone and holds nothing beyond the five fields (no email, no username, no token).
  const body = JSON.parse(new TextDecoder().decode(fromBase64Url(ticket.split('.')[1])));
  assert.deepEqual(Object.keys(body).sort(), ['a', 'd', 'exp', 'i', 'iat', 'n', 'th', 'v']);
  assert.ok(!ticket.includes('example.com'));
  assert.equal((await verifyTicket(ticket, { secret: SECRET, tokenHash: HASH_A, now: expiresAt })).ok, true);
  assert.equal((await verifyTicket(ticket, { secret: SECRET, tokenHash: HASH_A, now: expiresAt + 1 })).error.code, 'TICKET_EXPIRED');
  assert.equal((await verifyTicket(ticket, { secret: SECRET, tokenHash: HASH_B, now: NOW })).error.code, 'TICKET_MISMATCH', 'another browser cannot use it');
  assert.equal((await verifyTicket(ticket, { secret: OTHER_SECRET, tokenHash: HASH_A, now: NOW })).error.code, 'TICKET_INVALID');
});

test('a ticket with no avatar shows the default picture; a changed or odd ticket is refused', async () => {
  const plain = { id: ID, name: 'Taro', avatar: null, defaultIndex: 4 };
  const { ticket } = await issueTicket({ secret: SECRET, tokenHash: HASH_A, profile: plain, now: NOW });
  assert.equal((await verifyTicket(ticket, { secret: SECRET, tokenHash: HASH_A, now: NOW })).value.avatarUrl, 'https://cdn.discordapp.com/embed/avatars/4.png');

  const [version, body, mac] = ticket.split('.');
  const forged = value => `${version}.${toBase64Url(new TextEncoder().encode(JSON.stringify(value)))}.${mac}`;
  const real = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  for (const bad of [forged({ ...real, i: '99999999999999999' }), forged({ ...real, exp: real.exp + 1e9 }), `${version}.${body}.${'A'.repeat(43)}`,
    `v2.${body}.${mac}`, `${version}.${body}`, `${version}.${body}.${mac}.extra`, '', 'v1..', ticket + 'x', ticket.slice(1), 'x'.repeat(2000), null, undefined, 5, {}]) {
    assert.equal((await verifyTicket(bad, { secret: SECRET, tokenHash: HASH_A, now: NOW })).error.code, 'TICKET_INVALID', String(bad).slice(0, 40));
  }
});

test('a signed ticket whose fields are the wrong shape is still refused', async () => {
  // Signed by the right key but built by hand: the checks do not rest on the signature alone.
  const sign = async text => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
  };
  const make = async fields => {
    const body = toBase64Url(new TextEncoder().encode(JSON.stringify(fields)));
    return `v1.${body}.${await sign(`ticket|${body}`)}`;
  };
  const good = { v: 1, th: HASH_A, n: 'Taro', i: ID, a: AVATAR, d: 1, iat: NOW, exp: NOW + 1000 };
  assert.equal((await verifyTicket(await make(good), { secret: SECRET, tokenHash: HASH_A, now: NOW })).ok, true);
  for (const change of [{ v: 2 }, { th: 'short' }, { n: 5 }, { i: '12' }, { a: 'ZZ' }, { a: undefined, d: undefined }, { exp: 'soon' }, { exp: 1.5 }, { a: null, d: 9 }]) {
    assert.equal((await verifyTicket(await make({ ...good, ...change }), { secret: SECRET, tokenHash: HASH_A, now: NOW })).error.code, 'TICKET_INVALID', JSON.stringify(change));
  }
  assert.equal((await verifyTicket(`v1.${toBase64Url(new TextEncoder().encode('not json'))}.${await sign(`ticket|${toBase64Url(new TextEncoder().encode('not json'))}`)}`,
    { secret: SECRET, tokenHash: HASH_A, now: NOW })).error.code, 'TICKET_INVALID');
});

test('a key that is missing or short is an error, never a silent pass', async () => {
  for (const secret of [undefined, '', 'short']) {
    await assert.rejects(createState({ secret, tokenHash: HASH_A, now: NOW }), /auth key/);
    await assert.rejects(verifyTicket('v1.AAAA.' + 'A'.repeat(43), { secret, tokenHash: HASH_A, now: NOW }), /auth key/);
  }
});

test('the token hash a ticket is bound to is the one a room keeps (SHA-256 of the token)', async () => {
  const token = '0123456789abcdef0123456789abcdef';
  const hash = await sha256Hex(token);
  const { ticket } = await issueTicket({ secret: SECRET, tokenHash: hash, profile: { id: ID, name: 'T', avatar: null, defaultIndex: 0 }, now: NOW });
  assert.equal((await verifyTicket(ticket, { secret: SECRET, tokenHash: await sha256Hex(token), now: NOW })).ok, true);
  assert.equal((await verifyTicket(ticket, { secret: SECRET, tokenHash: await sha256Hex(`${token}0`), now: NOW })).error.code, 'TICKET_MISMATCH');
});
