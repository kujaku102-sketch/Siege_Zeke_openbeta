// A Discord ticket at hello: the room puts the avatar on the seat, tells the other guest, and lets a guest in whatever is wrong with the ticket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './online-test-kit.js';
import { issueTicket, verifyTicket } from '../src/network/discord-auth.js';
import { sha256Hex } from '../src/network/room-code.js';
import { parseClientMessage, LIMITS } from '../src/network/protocol.js';

// Test-only values.
const SECRET = 'test-only-auth-key-0123456789abcdef';
const ID = '80351110224678912';
const AVATAR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const AVATAR_URL = `https://cdn.discordapp.com/avatars/${ID}/${AVATAR}.png?size=128`;
const DEFAULT_URL = 'https://cdn.discordapp.com/embed/avatars/4.png';

const verifyProfile = (ticket, tokenHash) => verifyTicket(ticket, { secret: SECRET, tokenHash });
async function ticketFor(client, profile = { id: ID, name: 'ゆうき', avatar: AVATAR, defaultIndex: 4 }, now = Date.now()) {
  return (await issueTicket({ secret: SECRET, tokenHash: await sha256Hex(client.token), profile, now })).ticket;
}
const room = async (extra = { verifyProfile }) => {
  const harness = createHarness({ extra });
  await harness.core.init({ code: 'ABCD2345' });
  return harness;
};

test('hello may carry a ticket of up to 1024 characters, and nothing else new', () => {
  assert.equal(LIMITS.maxTicketChars, 1024);
  const hello = { v: 1, t: 'hello', token: '0'.repeat(32), name: 'x' };
  assert.equal(parseClientMessage(JSON.stringify({ ...hello, ticket: 'v1.a.b' })).value.ticket, 'v1.a.b');
  assert.equal(parseClientMessage(JSON.stringify(hello)).ok, true);
  assert.equal(parseClientMessage(JSON.stringify({ ...hello, ticket: 't'.repeat(1024) })).ok, true);
  for (const bad of [{ ticket: 't'.repeat(1025) }, { ticket: '' }, { ticket: 5 }, { ticket: null }, { avatar: AVATAR_URL }, { profile: {} }]) {
    assert.equal(parseClientMessage(JSON.stringify({ ...hello, ...bad })).ok, false, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(parseClientMessage(JSON.stringify({ v: 1, t: 'ready', userId: 'doors_zx', deck: { kind: 'start', deckId: 'x' }, ticket: 'x' })).ok, false, 'only hello takes a ticket');
});

test('a good ticket puts the picture on the seat, and the other guest sees it; a guest with none has null', async () => {
  const harness = await room();
  const a = harness.client('ゆうき'), b = harness.client('Taro');
  await a.open();
  await a.hello({ ticket: await ticketFor(a) });
  assert.equal(a.last('welcome').profile, 'ok');
  assert.equal(a.last('welcome').you.avatar, AVATAR_URL);
  assert.equal(a.last('welcome').opponent, null);
  await b.join();
  assert.equal(b.last('welcome').profile, 'none');
  assert.equal(b.last('welcome').you.avatar, null);
  assert.equal(b.last('welcome').opponent.avatar, AVATAR_URL, 'the second guest sees the first guest\'s picture');
  assert.equal(a.last('lobby').opponent.avatar, null, 'and the first sees none for the second');
  assert.equal(a.last('lobby').you.avatar, AVATAR_URL);
});

test('what the other guest receives is a name, a picture address and the existing fields; no ticket, id or token', async () => {
  const harness = await room();
  const a = harness.client('ゆうき'), b = harness.client('Taro');
  const ticket = await ticketFor(a);
  await a.open(); await a.hello({ ticket });
  await b.join();
  await a.ready(); await b.ready();
  const seen = JSON.stringify(b.frames);
  assert.ok(!seen.includes(ticket) && !seen.includes(a.token) && !seen.includes(await sha256Hex(a.token)), 'neither the ticket nor the token reaches the other side');
  assert.ok(!seen.includes('"i"') && !seen.includes('Discord'), 'no Discord fields');
  const start = b.last('start');
  assert.deepEqual(Object.keys(start.opponent).sort(), ['avatar', 'connected', 'graceMs', 'name', 'ready', 'userId']);
  assert.equal(start.opponent.avatar, AVATAR_URL);
  assert.deepEqual(Object.keys(start.you).sort(), ['avatar', 'name', 'ready', 'seat', 'slot']);
  assert.equal(a.last('start').you.avatar, AVATAR_URL);
  assert.equal(a.last('start').opponent.avatar, null);
});

test('a guest comes in whatever is wrong with the ticket, with no picture and the reason in the welcome', async () => {
  const welcomeFor = async (name, makeTicket) => {
    const harness = await room();
    const guest = harness.client(name);
    await guest.open();
    await guest.hello({ ticket: await makeTicket(guest) });
    return { welcome: guest.last('welcome'), guest };
  };
  const broken = [['garbage', 'not a ticket'], ['cut short', 'v1.AAAA.' + 'A'.repeat(43)], ['long', 't'.repeat(1000)]];
  for (const [label, ticket] of broken) {
    const { welcome, guest } = await welcomeFor(label, () => ticket);
    assert.equal(welcome.profile, 'invalid', label);
    assert.equal(welcome.you.avatar, null, label);
    assert.equal(guest.closed, null, 'the guest is not turned away');
  }
  const altered = await welcomeFor('altered', async guest => (await ticketFor(guest)).replace(/(.)(.)$/, (all, ch, last) => (ch === 'A' ? 'B' : 'A') + last));
  assert.equal(altered.welcome.profile, 'invalid');
  const otherBrowser = await welcomeFor('other', () => ticketFor({ token: 'f'.repeat(32) }));
  assert.equal(otherBrowser.welcome.profile, 'invalid', 'a ticket made for another browser is not accepted');
  assert.equal(otherBrowser.welcome.you.avatar, null);
  const stale = await welcomeFor('stale', async guest => (await issueTicket({ secret: SECRET, tokenHash: await sha256Hex(guest.token),
    profile: { id: ID, name: 'x', avatar: null, defaultIndex: 1 }, now: Date.now() - 31 * 24 * 3600 * 1000 })).ticket);
  assert.equal(stale.welcome.profile, 'expired');
  assert.equal(stale.welcome.you.avatar, null);
  const wrongKey = await welcomeFor('key', async guest => (await issueTicket({ secret: 'another-test-only-key-0123456789ab', tokenHash: await sha256Hex(guest.token),
    profile: { id: ID, name: 'x', avatar: AVATAR, defaultIndex: 1 } })).ticket);
  assert.equal(wrongKey.welcome.profile, 'invalid');
});

test('a room that cannot check tickets lets the guest in as a guest', async () => {
  const none = await room({});
  const a = none.client('A');
  await a.open(); await a.hello({ ticket: 'v1.AAAA.' + 'A'.repeat(43) });
  assert.equal(a.last('welcome').profile, 'unavailable');
  assert.equal(a.last('welcome').you.avatar, null);
  const broken = await room({ verifyProfile: () => { throw new Error('boom'); } });
  const b = broken.client('B');
  await b.open(); await b.hello({ ticket: 'v1.AAAA.' + 'A'.repeat(43) });
  assert.equal(b.last('welcome').profile, 'unavailable');
  const unavailable = await room({ verifyProfile: () => ({ ok: false, error: { code: 'UNAVAILABLE' } }) });
  const c = unavailable.client('C');
  await c.open(); await c.hello({ ticket: 'x' });
  assert.equal(c.last('welcome').profile, 'unavailable');
});

test('a checker that answers with an address that is not Discord\'s own is not believed', async () => {
  for (const avatarUrl of ['https://evil.example/a.png', 'javascript:alert(1)', 'https://cdn.discordapp.com/avatars/1/2.png', null, undefined, 5]) {
    const harness = await room({ verifyProfile: () => ({ ok: true, value: { avatarUrl } }) });
    const a = harness.client('A');
    await a.open(); await a.hello({ ticket: 'anything' });
    assert.equal(a.last('welcome').you.avatar, null, String(avatarUrl));
    assert.equal(a.last('welcome').profile, 'invalid');
  }
});

test('a returning guest keeps the picture; showing a good ticket again refreshes it; a bad one changes nothing', async () => {
  const harness = await room();
  const a = harness.client('ゆうき'), b = harness.client('Taro');
  await a.open(); await a.hello({ ticket: await ticketFor(a) });
  await b.join();
  await a.ready(); await b.ready();
  assert.equal(b.last('start').opponent.avatar, AVATAR_URL);

  await a.drop();
  // Back with no ticket at all: the seat keeps the picture it had.
  const back = harness.client('ゆうき');
  back.token = a.token;
  await back.open(); await back.hello({ haveRevision: 0 });
  assert.equal(back.last('welcome').profile, 'none');
  assert.equal(back.last('welcome').you.avatar, AVATAR_URL);
  assert.equal(back.last('welcome').opponent.avatar, null);
  assert.equal(b.last('peer').connected, true);

  // Back with a broken ticket: still the same picture.
  await back.drop();
  const again = harness.client('ゆうき');
  again.token = a.token;
  await again.open(); await again.hello({ ticket: 'broken', haveRevision: 0 });
  assert.equal(again.last('welcome').profile, 'invalid');
  assert.equal(again.last('welcome').you.avatar, AVATAR_URL);

  // Back with a good ticket for a changed picture: the seat takes the new one.
  await again.drop();
  const fresh = harness.client('ゆうき');
  fresh.token = a.token;
  await fresh.open();
  await fresh.hello({ ticket: await ticketFor(fresh, { id: ID, name: 'ゆうき', avatar: null, defaultIndex: 4 }), haveRevision: 0 });
  assert.equal(fresh.last('welcome').profile, 'ok');
  assert.equal(fresh.last('welcome').you.avatar, DEFAULT_URL);
});

test('the picture survives the room being woken in another process', async () => {
  const harness = await room();
  const a = harness.client('ゆうき');
  await a.open(); await a.hello({ ticket: await ticketFor(a) });
  const saved = harness.store;
  const next = createHarness({ store: saved, extra: { verifyProfile } });
  const again = next.client('ゆうき');
  again.token = a.token;
  await again.open(); await again.hello();
  assert.equal(again.last('welcome').you.avatar, AVATAR_URL);
});

test('a guest who leaves the lobby takes the picture with them; the next guest starts clean', async () => {
  const harness = await room();
  const a = harness.client('ゆうき'), b = harness.client('Taro');
  await a.open(); await a.hello({ ticket: await ticketFor(a) });
  await b.join();
  await a.send({ t: 'bye' });
  assert.equal(b.last('lobby').opponent, null);
  const c = harness.client('C');
  await c.join();
  assert.equal(c.last('welcome').opponent.avatar, null);
});

test('rooms made without any Discord setting behave exactly as before for a guest', async () => {
  const harness = await room({});
  const a = harness.client('A'), b = harness.client('B');
  await a.join(); await b.join();
  assert.equal(a.last('welcome').profile, 'none');
  assert.equal(b.last('welcome').opponent.avatar, null);
  await a.ready(); await b.ready();
  assert.equal(a.last('start').opponent.avatar, null);
  assert.equal(b.last('start').you.avatar, null);
});
