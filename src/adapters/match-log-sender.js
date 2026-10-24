// Where finished match logs go when sending is on (the Cloudflare Worker in cloudflare/match-log).
export const MATCH_LOG_ENDPOINT = 'https://log.siegezeke.online/match-logs';
// Browsers cap a beacon, and a keepalive fetch, at 64 KiB of body bytes; leave room for headers.
const BEACON_LIMIT = 60000;

// Fire and forget: a beacon survives the page closing; a larger log goes by fetch.
// The limit is in UTF-8 bytes, since a Japanese log is about three bytes a character.
// text/plain keeps it a simple request, so no CORS preflight is needed.
export function sendMatchLog(log, { endpoint = MATCH_LOG_ENDPOINT, beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator),
  post = globalThis.fetch?.bind(globalThis) } = {}) {
  const body = JSON.stringify(log);
  const type = 'text/plain;charset=UTF-8';
  try {
    const small = new TextEncoder().encode(body).length <= BEACON_LIMIT;
    if (small && beacon?.(endpoint, new Blob([body], { type }))) return true;
    post?.(endpoint, { method: 'POST', body, headers: { 'content-type': type }, keepalive: small })?.catch?.(() => {});
    return Boolean(post);
  } catch { return false; }
}
