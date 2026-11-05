// Discord login on the Worker: /auth/discord/start and /auth/discord/exchange (design: サーバー設計-Discordログイン.md §4).
// It keeps nothing: the state is signed, the token is given back, and the result is a signed ticket the browser holds.
// The settings it needs are two secrets (DISCORD_CLIENT_SECRET, AUTH_KEY) and two variables (DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI).
// Without any of them it answers SERVER_MISCONFIGURED before calling Discord, and rooms keep working for guests.
import { avatarUrl, buildAuthorizeUrl, createState, issueTicket, pkceChallenge, pkceVerifier, profileOfDiscordUser, verifyState, AUTH_LIMITS } from '../../../src/network/discord-auth.js';
import { discordBaseOf, discordEndpoints, fetchDiscordUser } from '../../../src/network/discord-api.js';
import { isGuestToken } from '../../../src/network/guest-token.js';
import { sha256Hex } from '../../../src/network/room-code.js';

const CODE = /^[\w.~-]{1,256}$/;
const STATUS = { BAD_REQUEST: 400, AUTH_STATE_INVALID: 400, AUTH_STATE_EXPIRED: 400, AUTH_CODE_INVALID: 400,
  SERVER_MISCONFIGURED: 500, DISCORD_UNREACHABLE: 503, DISCORD_BAD_REPLY: 503 };
const fail = code => ({ status: STATUS[code] ?? 500, body: { code } });

function redirectOk(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch { return false; }
}

// -> the settings, or null when one is missing or malformed.
export function authConfig(env) {
  const base = discordBaseOf(env.DISCORD_BASE);
  const clientId = env.DISCORD_CLIENT_ID;
  const secret = env.DISCORD_CLIENT_SECRET;
  const key = env.AUTH_KEY;
  if (!base || typeof clientId !== 'string' || !/^\d{5,25}$/.test(clientId) || typeof secret !== 'string' || secret.length < 8
    || typeof key !== 'string' || key.length < AUTH_LIMITS.secretMinChars || typeof env.DISCORD_REDIRECT_URI !== 'string' || !redirectOk(env.DISCORD_REDIRECT_URI)) return null;
  return { endpoints: discordEndpoints(base), clientId, clientSecret: secret, authKey: key, redirectUri: env.DISCORD_REDIRECT_URI };
}

// body { token } -> { url, state, expiresAt }
export async function authStart(body, env, { now = Date.now() } = {}) {
  const config = authConfig(env);
  if (!config) return fail('SERVER_MISCONFIGURED');
  if (!isGuestToken(body?.token)) return fail('BAD_REQUEST');
  const tokenHash = await sha256Hex(body.token);
  const { state, expiresAt } = await createState({ secret: config.authKey, tokenHash, now });
  const challenge = await pkceChallenge(await pkceVerifier(config.authKey, state));
  const url = buildAuthorizeUrl({ authorizeBase: config.endpoints.authorize, clientId: config.clientId, redirectUri: config.redirectUri, state, challenge });
  return { status: 200, body: { url, state, expiresAt } };
}

// body { code, state, token, iss? } -> { ticket, profile: { name, avatarUrl, expiresAt } }
export async function authExchange(body, env, { fetchImpl = (...args) => fetch(...args), defer = null, now = Date.now() } = {}) {
  const config = authConfig(env);
  if (!config) return fail('SERVER_MISCONFIGURED');
  if (typeof body?.code !== 'string' || !CODE.test(body.code) || typeof body.state !== 'string' || !isGuestToken(body.token)
    || (body.iss !== undefined && body.iss !== config.endpoints.issuer)) return fail('BAD_REQUEST');
  const tokenHash = await sha256Hex(body.token);
  // Everything that can be checked here is checked before Discord is called, so a bad request costs Discord nothing.
  const checked = await verifyState(body.state, { secret: config.authKey, tokenHash, now });
  if (!checked.ok) return fail(checked.error.code);
  const found = await fetchDiscordUser({ fetchImpl, endpoints: config.endpoints, clientId: config.clientId, clientSecret: config.clientSecret,
    redirectUri: config.redirectUri, code: body.code, verifier: await pkceVerifier(config.authKey, body.state), defer });
  if (!found.ok) return fail(found.error.code);
  const profile = profileOfDiscordUser(found.user);
  if (!profile.ok) return fail(profile.error.code);
  const { ticket, expiresAt } = await issueTicket({ secret: config.authKey, tokenHash, profile: profile.value, now });
  const picture = avatarUrl({ id: profile.value.id, avatar: profile.value.avatar, defaultIndex: profile.value.defaultIndex });
  return { status: 200, body: { ticket, profile: { name: profile.value.name, avatarUrl: picture, expiresAt } } };
}
