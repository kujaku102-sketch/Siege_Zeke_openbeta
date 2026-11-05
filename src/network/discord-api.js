// Calls to Discord for one login: trade the code for a token, read who it is (scope identify only), and give the token back.
// The fetch is passed in, so tests answer with a fake Discord. Nothing is kept: the token lives only inside fetchDiscordUser.
// Errors carry a code only, never Discord's reply, and nothing here logs.
export const DISCORD_BASE = 'https://discord.com';
export const DISCORD_USER_AGENT = 'DiscordBot (https://siegezeke.online, 1.0)';
const REQUEST_MS = 8000;

export function discordEndpoints(base = DISCORD_BASE) {
  return Object.freeze({ issuer: base, authorize: `${base}/oauth2/authorize`, token: `${base}/api/oauth2/token`,
    revoke: `${base}/api/oauth2/token/revoke`, me: `${base}/api/v10/users/@me` });
}

// The real Discord, or (for a test on this PC) a server on localhost. Anything else is refused.
export function discordBaseOf(value) {
  if (value === undefined || value === null || value === '') return DISCORD_BASE;
  try {
    const url = new URL(value);
    if (url.origin === DISCORD_BASE) return DISCORD_BASE;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin;
  } catch { /* not an address */ }
  return null;
}

const failure = (code, status) => ({ ok: false, error: { code, ...(status ? { status } : {}) } });
const timeout = () => typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(REQUEST_MS) : undefined;
const basic = (id, secret) => `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;

async function ask(fetchImpl, url, init) {
  try { return await fetchImpl(url, { ...init, signal: timeout() }); } catch { return null; }
}

// -> { ok: true, user } with the /users/@me object, or { ok: false, error: { code } }:
//    AUTH_CODE_INVALID (the code was used or expired), SERVER_MISCONFIGURED (Discord does not accept our client),
//    DISCORD_UNREACHABLE (no answer, a rate limit, a server error, or a reply that is not a user).
// defer(promise) lets a Worker finish the revoke after the reply (ctx.waitUntil); without it the revoke is awaited.
export async function fetchDiscordUser({ fetchImpl, endpoints, clientId, clientSecret, redirectUri, code, verifier, defer = null }) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  const tokenReply = await ask(fetchImpl, endpoints.token, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(clientId, clientSecret), 'user-agent': DISCORD_USER_AGENT, accept: 'application/json' },
    body: form.toString() });
  if (!tokenReply) return failure('DISCORD_UNREACHABLE');
  if (tokenReply.status === 400) return failure('AUTH_CODE_INVALID');
  if (tokenReply.status === 401) return failure('SERVER_MISCONFIGURED');
  if (!tokenReply.ok) return failure('DISCORD_UNREACHABLE', tokenReply.status);
  let accessToken;
  try { accessToken = (await tokenReply.json())?.access_token; } catch { accessToken = null; }
  if (typeof accessToken !== 'string' || accessToken === '') return failure('DISCORD_UNREACHABLE');

  const meReply = await ask(fetchImpl, endpoints.me, { headers: { authorization: `Bearer ${accessToken}`, 'user-agent': DISCORD_USER_AGENT, accept: 'application/json' } });
  let user = null;
  if (meReply?.ok) { try { user = await meReply.json(); } catch { user = null; } }

  // The token is given back whether or not the user could be read.
  const revoking = ask(fetchImpl, endpoints.revoke, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(clientId, clientSecret), 'user-agent': DISCORD_USER_AGENT },
    body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }).toString() });
  if (defer) defer(revoking); else await revoking;

  if (!user || typeof user !== 'object') return failure('DISCORD_UNREACHABLE', meReply?.status);
  return { ok: true, user };
}
