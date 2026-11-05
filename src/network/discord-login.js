// The page's side of the Discord login (design: サーバー設計-Discordログイン.md §4.4).
//
//   const login = createDiscordLogin({ endpoint, storage: localStorage, session: sessionStorage });
//   await login.start();                    // on the button: asks the server for the address, then sends the page to Discord
//   // ... Discord sends the browser back to the callback page, whose address has ?code=...&state=...
//   const result = await login.finish(location.search);   // { ok: true, profile } or { ok: false, error: { code } }
//   login.profile();                        // { name, avatarUrl, expiresAt } or null (none, or past its 30 days)
//   login.ticket();                         // the signed ticket to give createRoom / joinRoom, or null
//   login.logout();                         // forgets the login on this browser; the server holds nothing to delete
//
// Pure of the browser: storage, fetch, navigation and the clock are passed in. Error codes (error.code):
//   ONLINE_UNAVAILABLE      no server address is configured          STORAGE_UNAVAILABLE   the state could not be kept across the trip
//   SERVER_UNREACHABLE      the server did not answer                SERVER_MISCONFIGURED  the server has no Discord settings yet
//   RATE_LIMITED, FORBIDDEN the door refused                         DISCORD_UNREACHABLE   Discord did not answer (try again later)
//   DISCORD_DENIED          the user said no on Discord's screen     DISCORD_ERROR         Discord sent the user back with another error
//   AUTH_STATE_INVALID      the way back did not match the way out   AUTH_STATE_EXPIRED    more than 10 minutes passed on Discord's screen
//   AUTH_CODE_INVALID       Discord's code was used or expired       DISCORD_BAD_REPLY     the answer was not what was expected
//   NOT_A_CALLBACK          finish() was given an address that is not a Discord return (result.ignored is true)
import { discordAuthUrl } from './endpoint.js';
import { guestToken } from './guest-token.js';
import { AUTH_LIMITS, isDiscordAvatarUrl } from './discord-auth.js';

export const PROFILE_KEY = 'sz-discord-profile';   // storage: { ticket, name, avatarUrl, expiresAt }
export const STATE_KEY = 'sz-discord-state';       // session: { state, at }, only for the trip to Discord and back

const failure = (code, extra = {}) => ({ ok: false, error: { code }, ...extra });
const readJson = (store, key) => {
  try { const text = store?.getItem(key); return text ? JSON.parse(text) : null; } catch { return null; }
};
const forget = (store, key) => { try { store?.removeItem(key); } catch { /* blocked */ } };

// What the server may answer with: its own code, else a guess from the status.
function codeOf(status, body) {
  if (typeof body?.code === 'string' && /^[A-Z_]{3,40}$/.test(body.code)) return body.code;
  return status === 429 ? 'RATE_LIMITED' : status === 403 ? 'FORBIDDEN' : status >= 500 ? 'DISCORD_UNREACHABLE' : 'SERVER_UNREACHABLE';
}

export function createDiscordLogin({ endpoint, storage = null, session = null, fetchImpl = (...args) => globalThis.fetch(...args),
  navigate = url => globalThis.location.assign(url), now = () => Date.now(), randomBytes } = {}) {
  const tokenOf = () => guestToken(storage, randomBytes);
  // The trip's state goes in the tab's session storage; where that is blocked, in the ordinary storage.
  const trip = session ?? storage;

  const saved = () => {
    const found = readJson(storage, PROFILE_KEY);
    if (!found || typeof found.ticket !== 'string' || found.ticket === '' || found.ticket.length > AUTH_LIMITS.ticketMaxChars
      || typeof found.name !== 'string' || !isDiscordAvatarUrl(found.avatarUrl) || !Number.isFinite(found.expiresAt)) return null;
    if (now() > found.expiresAt) { forget(storage, PROFILE_KEY); return null; }
    return found;
  };

  async function post(step, body) {
    let response;
    try {
      response = await fetchImpl(discordAuthUrl(endpoint, step), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch { return { error: 'SERVER_UNREACHABLE' }; }
    let reply = null;
    try { reply = await response.json(); } catch { /* no body */ }
    return response.status === 200 ? { reply } : { error: codeOf(response.status, reply) };
  }

  const available = () => typeof endpoint === 'string' && endpoint !== '';
  const isCallback = search => { const params = new URLSearchParams(search ?? ''); return params.has('state') && (params.has('code') || params.has('error')); };

  return Object.freeze({
    available,
    isCallback,
    profile() {
      const found = saved();
      return found ? { name: found.name, avatarUrl: found.avatarUrl, expiresAt: found.expiresAt } : null;
    },
    ticket: () => saved()?.ticket ?? null,

    // -> { ok: true, url } after the page has been sent to Discord; the page leaves, so the caller seldom sees this.
    async start() {
      if (!available()) return failure('ONLINE_UNAVAILABLE');
      const done = await post('start', { token: tokenOf() });
      if (done.error) return failure(done.error);
      const { url, state } = done.reply ?? {};
      if (typeof url !== 'string' || typeof state !== 'string' || !/^https?:\/\//.test(url)) return failure('DISCORD_BAD_REPLY');
      try { trip.setItem(STATE_KEY, JSON.stringify({ state, at: now() })); } catch { return failure('STORAGE_UNAVAILABLE'); }
      navigate(url);
      return { ok: true, url };
    },

    // search: the callback page's location.search.
    async finish(search) {
      const params = new URLSearchParams(search ?? '');
      if (!isCallback(search)) return failure('NOT_A_CALLBACK', { ignored: true });
      // The state kept for this trip is used once, whatever happens next.
      const kept = readJson(trip, STATE_KEY);
      forget(trip, STATE_KEY);
      const state = params.get('state');
      if (!kept || typeof kept.state !== 'string' || kept.state !== state) return failure('AUTH_STATE_INVALID');
      if (now() - kept.at > AUTH_LIMITS.stateMs) return failure('AUTH_STATE_EXPIRED');
      if (params.has('error')) return failure(params.get('error') === 'access_denied' ? 'DISCORD_DENIED' : 'DISCORD_ERROR');
      if (!available()) return failure('ONLINE_UNAVAILABLE');
      const iss = params.get('iss');
      const done = await post('exchange', { code: params.get('code') ?? '', state, token: tokenOf(), ...(iss ? { iss } : {}) });
      if (done.error) return failure(done.error);
      const { ticket, profile } = done.reply ?? {};
      if (typeof ticket !== 'string' || ticket === '' || ticket.length > AUTH_LIMITS.ticketMaxChars || typeof profile?.name !== 'string'
        || !isDiscordAvatarUrl(profile.avatarUrl) || !Number.isFinite(profile.expiresAt)) return failure('DISCORD_BAD_REPLY');
      const value = { ticket, name: profile.name, avatarUrl: profile.avatarUrl, expiresAt: profile.expiresAt };
      try { storage.setItem(PROFILE_KEY, JSON.stringify(value)); } catch { return failure('STORAGE_UNAVAILABLE'); }
      return { ok: true, profile: { name: value.name, avatarUrl: value.avatarUrl, expiresAt: value.expiresAt } };
    },

    logout() {
      forget(storage, PROFILE_KEY);
      forget(trip, STATE_KEY);
    }
  });
}
