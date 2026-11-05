// the page's side of the Discord login (design サーバー設計-Discordログイン.md §10,
// §14.2), DOM-free. The switch, the profile with a Discord name, the way out and back, the name screen, the room's line,
// the setting, and the board's pictures (with a small stand-in for the circles).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const W = fileURLToPath(new URL('../', import.meta.url));
const source = async p => (await readFile(W + p, 'utf8')).replace(/\r\n/g, '\n');
import { DISCORD_LOGIN_ENABLED, discordLoginShown } from '../src/config/discord-login.js';
import { NAME_USE_KEY, readOnlineProfile, saveOnlineProfile, preferDiscordName } from '../src/ui-refresh/online-profile.js';
import { RETURN_KEY, withoutAnswer, startDiscordLogin, finishDiscordLogin, loginErrorText } from '../src/ui-refresh/online-login.js';
import { onlineNameHtml, onlineRoomHtml } from '../src/ui-refresh/online-screens-view.js';
import { syncSeatAvatars } from '../src/ui-refresh/seat-avatars.js';
import { NAME_KEY } from '../src/network/online-client.js';

const memory = (entries = {}) => { const map = new Map(Object.entries(entries)); return { map, getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) }; };
const AVATAR = 'https://cdn.discordapp.com/avatars/80351110224678912/a1b2c3d4e5f60718293a4b5c6d7e8f90.png?size=128';
const discord = { name: 'ゆうき', avatarUrl: AVATAR, expiresAt: 2_000_000_000_000 };

test('the login is off until it is switched on in one place; a page on this PC may turn it on with ?discord=1', () => {
  assert.equal(DISCORD_LOGIN_ENABLED, false, 'off: no public page shows it yet');
  assert.equal(discordLoginShown({ hostname: 'siegezeke.online', search: '?discord=1' }), false, 'the query is ignored on the site');
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(discordLoginShown({ hostname, search: '?online=x&discord=1' }), true, hostname);
  for (const search of ['', '?discord=0', '?discord=true', '?discord']) assert.equal(discordLoginShown({ hostname: '127.0.0.1', search }), false, search);
  assert.equal(discordLoginShown({ hostname: 'siegezeke.online', search: '', enabled: true }), true, 'switched on, everywhere');
});

test('with a login the Discord name comes first; a typed name is kept and can be chosen over it; logging in again prefers Discord', () => {
  const storage = memory();
  assert.deepEqual({ ...readOnlineProfile(storage, discord) }, { source: 'discord', name: 'ゆうき', icon: AVATAR, discordName: 'ゆうき', typedName: null });
  const typed = saveOnlineProfile(storage, 'みどり', discord);
  assert.deepEqual({ ...typed }, { source: 'guest', name: 'みどり', icon: AVATAR, discordName: 'ゆうき', typedName: 'みどり' }, 'the picture stays with a typed name');
  assert.equal(storage.map.get(NAME_KEY), 'みどり');
  assert.equal(storage.map.get(NAME_USE_KEY), 'typed');
  assert.equal(readOnlineProfile(storage, discord).name, 'みどり');
  const back = saveOnlineProfile(storage, 'ゆうき', discord);
  assert.equal(back.source, 'discord');
  assert.equal(storage.map.get(NAME_KEY), 'みどり', 'choosing the Discord name keeps the typed one');
  assert.equal(storage.map.has(NAME_USE_KEY), false);
  saveOnlineProfile(storage, 'みどり', discord);
  preferDiscordName(storage);
  assert.equal(readOnlineProfile(storage, discord).name, 'ゆうき', 'a new login makes the Discord name the first choice again');
  // Logged out: the typed name, no picture; with none typed, no name (ask again).
  assert.deepEqual({ ...readOnlineProfile(storage, null) }, { source: 'guest', name: 'みどり', icon: null, discordName: null, typedName: 'みどり' });
  assert.equal(readOnlineProfile(memory(), null), null);
  // A long Discord name is cut to the room's 16 characters.
  assert.equal(readOnlineProfile(memory(), { ...discord, name: 'あ'.repeat(30) }).name, 'あ'.repeat(16));
});

test('the way out keeps where to come back to; the way back takes the answer out of the address and finishes', async () => {
  assert.equal(withoutAnswer('?online=http%3A%2F%2F127.0.0.1%3A8801&discord=1&code=abc&state=s&iss=x'), '?online=http%3A%2F%2F127.0.0.1%3A8801&discord=1');
  assert.equal(withoutAnswer('?code=abc&state=s'), '');
  const session = memory();
  const started = await startDiscordLogin({ start: async () => ({ ok: true, url: 'https://discord.test/' }) }, { session, location: { pathname: '/mobile/', search: '?online=x&code=old' } });
  assert.equal(started.ok, true);
  assert.deepEqual(JSON.parse(session.map.get(RETURN_KEY)), { path: '/mobile/', search: '?online=x' });
  const refused = await startDiscordLogin({ start: async () => ({ ok: false, error: { code: 'SERVER_MISCONFIGURED' } }) }, { session, location: { pathname: '/', search: '' } });
  assert.equal(refused.error.code, 'SERVER_MISCONFIGURED');
  assert.equal(session.map.has(RETURN_KEY), false, 'a refused way out keeps nothing');
  const replaced = [];
  const login = { isCallback: search => search.includes('state='), finish: async search => ({ ok: true, profile: { search } }) };
  const history = { state: null, replaceState: (state, title, url) => replaced.push(url) };
  const done = await finishDiscordLogin(login, { location: { pathname: '/', search: '?online=x&code=c&state=s', hash: '' }, history });
  assert.deepEqual(done, { ok: true, profile: { search: '?online=x&code=c&state=s' } }, 'finish reads the answer as it came');
  assert.deepEqual(replaced, ['/?online=x'], 'the address keeps the rest');
  assert.equal(await finishDiscordLogin(login, { location: { pathname: '/', search: '?online=x', hash: '' }, history }), null, 'not a way back');
});

test('a failed login says why and that a name can still be typed', () => {
  assert.equal(loginErrorText(null), '');
  assert.equal(loginErrorText('DISCORD_DENIED'), 'Discordでのログインが取り消されました。名前を入れて遊ぶこともできます。');
  assert.equal(loginErrorText('SERVER_MISCONFIGURED'), 'Discordでのログインは準備中です。名前を入れて遊ぶこともできます。');
  assert.equal(loginErrorText('SOMETHING_NEW'), 'Discordでログインできませんでした。名前を入れて遊ぶこともできます。');
});

test('the name screen: no login part while it is not offered; out, the words-only button and what the opponent sees; in, who and ログアウト', () => {
  assert.doesNotMatch(onlineNameHtml({ online: { profile: null, login: null } }), /data-online-login|r2-online-login/);
  const out = onlineNameHtml({ online: { profile: null, login: { busy: false, error: null } } });
  assert.match(out, /<button data-online-login>Discordでログイン<\/button>/);
  assert.match(out, /アイコンは対戦相手の画面に出ます/);
  assert.doesNotMatch(out, /<img|<svg/, 'no Discord logo (Q7)');
  assert.match(onlineNameHtml({ online: { profile: null, login: { busy: true, error: null } } }), /data-online-login aria-disabled="true" data-busy>Discordへ移動しています…/);
  assert.match(onlineNameHtml({ online: { profile: null, login: { busy: false, error: 'DISCORD_DENIED' } } }), /role="alert">Discordでのログインが取り消されました。/);
  const profile = { source: 'discord', name: '<ゆうき>', icon: AVATAR, discordName: '<ゆうき>', typedName: 'みどり' };
  const inside = onlineNameHtml({ online: { profile, login: { busy: false, error: null } } });
  assert.match(inside, /Discord：<b>&lt;ゆうき&gt;<\/b> でログイン中<\/p><button data-online-logout>ログアウト<\/button>/);
  assert.match(inside, /<button data-online-name-pick="typed">登録した名前に戻す<\/button>/);
  assert.doesNotMatch(inside, /data-online-name-pick="discord"/, 'the field already holds the Discord name');
  const typed = onlineNameHtml({ online: { profile: { ...profile, source: 'guest', name: 'みどり' }, login: { busy: false, error: null } } });
  assert.match(typed, /<button data-online-name-pick="discord">Discordの名前にする<\/button>/);
  assert.doesNotMatch(typed, /data-online-name-pick="typed"/);
});

test('a room whose login was not taken says so, and no picture shows', () => {
  const state = { status: 'lobby', display: 'K7M2-QX9D', you: { name: 'あ', ready: false }, opponent: null };
  assert.match(onlineRoomHtml({ online: { state, login: { error: 'LOGIN_EXPIRED' } } }, { now: 0 }), /Discordのログインの期限が切れたため、アイコンは出ません。/);
  assert.doesNotMatch(onlineRoomHtml({ online: { state, login: { error: null } } }, { now: 0 }), /期限が切れた/);
});

test('the board\'s circles: a picture with no referrer; one that fails is dropped for good and the colour shows; none, none', () => {
  // A stand-in for the two circles: enough of the DOM for seat-avatars.js.
  const element = tag => {
    const node = { tagName: tag, children: [], attributes: {}, listeners: {}, parent: null,
      setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return name === 'src' ? this.src ?? null : this.attributes[name] ?? null; },
      addEventListener(type, fn) { this.listeners[type] = fn; }, append(child) { child.parent = this; this.children.push(child); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); this.parent = null; },
      querySelector(selector) { return selector === 'img.wf-avatar-img' ? this.children.find(item => item.className === 'wf-avatar-img') ?? null : null; } };
    node.ownerDocument = { createElement: element };
    return node;
  };
  const circles = { 'wf-self': element('button'), 'wf-enemy': element('button') };
  const root = { querySelector: selector => circles[selector.match(/^\.(wf-\w+) /)[1]] ?? null };
  syncSeatAvatars(root, { self: AVATAR, opponent: null });
  const mine = circles['wf-self'].children[0];
  assert.equal(mine.src, AVATAR);
  assert.equal(mine.attributes.referrerpolicy, 'no-referrer');
  assert.equal(circles['wf-enemy'].children.length, 0, 'no picture: the circle\'s own colour');
  syncSeatAvatars(root, { self: AVATAR, opponent: null });
  assert.equal(circles['wf-self'].children[0], mine, 'the same picture is left alone');
  const OTHER = AVATAR.replace('a1b2', 'ffff');
  syncSeatAvatars(root, { self: AVATAR, opponent: OTHER });
  circles['wf-enemy'].children[0].listeners.error();
  assert.equal(circles['wf-enemy'].children.length, 0, 'a picture that cannot be read goes');
  syncSeatAvatars(root, { self: AVATAR, opponent: OTHER });
  assert.equal(circles['wf-enemy'].children.length, 0, 'and is not asked for again');
  syncSeatAvatars(root, null);
  assert.equal(circles['wf-self'].children.length, 0);
});

test('wiring: the ticket goes only with 「アイコンを相手に見せる」 on, a login the room refused is forgotten, and the setting shows only with the login', async () => {
  const main = await source('src/main.js');
  assert.ok(main.includes("const ticket = host.showAvatar ? discordLogin?.ticket() ?? undefined : undefined;"));
  assert.ok(main.includes("join ? await client.joinRoom(code,{name,ticket}) : await client.createRoom({name,ticket})"));
  assert.ok(main.includes("if (['invalid','expired'].includes(state.ticketStatus) && discordProfile()) {discordLogin.logout();"));
  assert.ok(main.includes("const discordLogin = discordLoginShown({hostname:location.hostname,search:location.search})"));
  const shell = await source('src/ui-refresh/runtime-shell-view.js');
  assert.ok(shell.includes(`\${ui.discordLogin ? toggle("アイコンを相手に見せる", 'data-toggle-show-avatar', ui.showAvatar !== false) : ""}`));
  const crt = await source('src/ui-refresh/entry-crt-viewport.js');
  assert.ok(crt.includes(`...(options.discordLogin ? [["アイコンを相手に見せる", options.showAvatar !== false, '[data-toggle-show-avatar]']] : [])`));
  // Back from Discord the page boots again: the screen opens after the splash, and a curved screen measured while the page
  // was hidden (boot-splash.css) is measured again when the splash ends.
  assert.ok(main.includes('if (!result) return;\n  await bootDone();'));
  const glass = await source('src/ui-refresh/flow-crt-viewport.js');
  assert.ok(glass.includes('boot.observe(document.body, { attributes: true, attributeFilter: ["class"] });') && glass.includes('boot.disconnect();'));
  const callback = await source('public/discord-callback.js');
  assert.ok(callback.includes('sessionStorage.getItem("sz-discord-return")') && callback.includes('location.replace('));
  assert.match(await source('public/discord-callback.html'), /<script src="\.\/discord-callback\.js" defer><\/script>/, 'no inline script (CSP)');
});
