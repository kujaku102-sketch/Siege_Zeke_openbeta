// Discord login, the parts that need no network (design: サーバー設計-Discordログイン.md §3-§4).
// A login hands the browser a signed "ticket" holding a name and an avatar; nothing about it is stored on the server.
// Pure: WebCrypto only (browser, Node 20+, Workers). The signing key is a Worker secret passed in as `secret`.
import { sanitizeGuestName } from './protocol.js';

export const AUTH_LIMITS = Object.freeze({
  stateMs: 10 * 60 * 1000,
  ticketMs: 30 * 24 * 60 * 60 * 1000,
  ticketMaxChars: 1024,
  secretMinChars: 16
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const failure = code => ({ ok: false, error: { code } });

// ---- base64url ---------------------------------------------------------------
export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch { return null; }
}

// ---- HMAC ----------------------------------------------------------------------
const keyCache = new Map();
async function macKey(secret) {
  if (typeof secret !== 'string' || secret.length < AUTH_LIMITS.secretMinChars) throw new Error('the auth key is missing or too short');
  const cached = keyCache.get(globalThis.crypto.subtle);
  if (cached?.secret === secret) return cached.key;
  const key = await globalThis.crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  keyCache.set(globalThis.crypto.subtle, { secret, key });
  return key;
}
const sign = async (secret, text) => new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', await macKey(secret), encoder.encode(text)));
const verifyMac = async (secret, text, mac) => globalThis.crypto.subtle.verify('HMAC', await macKey(secret), mac, encoder.encode(text));
const sha256 = async text => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));

// ---- state and PKCE ------------------------------------------------------------------
// state = nonce.expiry.mac. It is signed over the browser token's hash, so only the browser that started a login can finish it.
// Nothing is stored: the PKCE verifier is recomputed from the state and the secret.
const STATE = /^([A-Za-z0-9_-]{22})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/;

export async function createState({ secret, tokenHash, now = Date.now(), bytes = globalThis.crypto.getRandomValues(new Uint8Array(16)) }) {
  const nonce = toBase64Url(bytes.slice(0, 16));
  const expires = String(now + AUTH_LIMITS.stateMs);
  const mac = toBase64Url(await sign(secret, `state|${nonce}|${expires}|${tokenHash}`));
  return { state: `${nonce}.${expires}.${mac}`, expiresAt: Number(expires) };
}

export async function verifyState(state, { secret, tokenHash, now = Date.now() }) {
  const match = typeof state === 'string' && state.length <= 128 ? STATE.exec(state) : null;
  if (!match) return failure('AUTH_STATE_INVALID');
  const [, nonce, expires, mac] = match;
  const macBytes = fromBase64Url(mac);
  if (!macBytes || !await verifyMac(secret, `state|${nonce}|${expires}|${tokenHash}`, macBytes)) return failure('AUTH_STATE_INVALID');
  if (now > Number(expires)) return failure('AUTH_STATE_EXPIRED');
  return { ok: true, value: { nonce } };
}

export async function pkceVerifier(secret, state) {
  return toBase64Url(await sign(secret, `pkce|${state}`));
}
export async function pkceChallenge(verifier) {
  return toBase64Url(await sha256(verifier));
}

export function buildAuthorizeUrl({ authorizeBase = 'https://discord.com/oauth2/authorize', clientId, redirectUri, state, challenge }) {
  const url = new URL(authorizeBase);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// ---- name and avatar ------------------------------------------------------------------
const USER_ID = /^\d{17,20}$/;
const AVATAR_HASH = /^(?:a_)?[0-9a-f]{32}$/;
// The only addresses that are ever sent to a page or drawn: Discord's own CDN, a still PNG.
const AVATAR_URL = /^https:\/\/cdn\.discordapp\.com\/(?:avatars\/\d{17,20}\/(?:a_)?[0-9a-f]{32}\.png\?size=128|embed\/avatars\/[0-5]\.png)$/;

export const isDiscordAvatarUrl = value => typeof value === 'string' && value.length <= 160 && AVATAR_URL.test(value);

// Display name: global_name (what people see on Discord), else username; cleaned and cut like a guest name.
export function pickDisplayName(user) {
  for (const candidate of [user?.global_name, user?.username]) {
    if (typeof candidate !== 'string') continue;
    const name = sanitizeGuestName(candidate, '');
    if (name) return name;
  }
  return 'Discord';
}

// The picture Discord shows for someone with no avatar: (id >> 22) % 6, or discriminator % 5 for an old-style tag.
export function defaultAvatarIndex({ id, discriminator }) {
  if (typeof discriminator === 'string' && /^\d{1,4}$/.test(discriminator) && Number(discriminator) !== 0) return Number(discriminator) % 5;
  return Number((BigInt(id) >> 22n) % 6n);
}

// -> the address, or null when the id or hash is not in the expected shape.
export function avatarUrl({ id, avatar, defaultIndex }) {
  if (!USER_ID.test(String(id))) return null;
  if (typeof avatar === 'string' && AVATAR_HASH.test(avatar)) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`;
  return Number.isInteger(defaultIndex) && defaultIndex >= 0 && defaultIndex <= 5 ? `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png` : null;
}

// The four fields of Discord's /users/@me that are used, checked. Anything else in the reply is ignored.
export function profileOfDiscordUser(user) {
  if (!user || typeof user !== 'object' || !USER_ID.test(String(user.id))) return failure('DISCORD_BAD_REPLY');
  const id = String(user.id);
  const avatar = typeof user.avatar === 'string' && AVATAR_HASH.test(user.avatar) ? user.avatar : null;
  return { ok: true, value: { id, name: pickDisplayName(user), avatar, defaultIndex: defaultAvatarIndex({ id, discriminator: user.discriminator }) } };
}

// ---- ticket ----------------------------------------------------------------------------
// v1.<body>.<mac>. The body is not secret (a Discord id, a name, an avatar hash); the mac says this server made it, for this browser.
export async function issueTicket({ secret, tokenHash, profile, now = Date.now() }) {
  const body = toBase64Url(encoder.encode(JSON.stringify({ v: 1, th: tokenHash, n: profile.name, i: profile.id, a: profile.avatar,
    d: profile.defaultIndex, iat: now, exp: now + AUTH_LIMITS.ticketMs })));
  const mac = toBase64Url(await sign(secret, `ticket|${body}`));
  return { ticket: `v1.${body}.${mac}`, expiresAt: now + AUTH_LIMITS.ticketMs };
}

const TICKET = /^v1\.([A-Za-z0-9_-]{1,900})\.([A-Za-z0-9_-]{43})$/;
const HASH_HEX = /^[0-9a-f]{64}$/;

// -> { ok, value: { name, avatarUrl, expiresAt } } or an error: TICKET_INVALID, TICKET_MISMATCH (another browser), TICKET_EXPIRED
export async function verifyTicket(ticket, { secret, tokenHash, now = Date.now() }) {
  const match = typeof ticket === 'string' && ticket.length <= AUTH_LIMITS.ticketMaxChars ? TICKET.exec(ticket) : null;
  if (!match) return failure('TICKET_INVALID');
  const mac = fromBase64Url(match[2]);
  if (!mac || !await verifyMac(secret, `ticket|${match[1]}`, mac)) return failure('TICKET_INVALID');
  let body;
  try { body = JSON.parse(decoder.decode(fromBase64Url(match[1]))); } catch { return failure('TICKET_INVALID'); }
  if (!body || body.v !== 1 || !HASH_HEX.test(body.th ?? '') || typeof body.n !== 'string' || !Number.isSafeInteger(body.exp)
    || !(body.a === null || AVATAR_HASH.test(body.a ?? '')) || !USER_ID.test(String(body.i))) return failure('TICKET_INVALID');
  const url = avatarUrl({ id: body.i, avatar: body.a, defaultIndex: body.d });
  if (!url) return failure('TICKET_INVALID');
  if (body.th !== tokenHash) return failure('TICKET_MISMATCH');
  if (now > body.exp) return failure('TICKET_EXPIRED');
  return { ok: true, value: { name: sanitizeGuestName(body.n, 'Discord'), avatarUrl: url, expiresAt: body.exp } };
}
