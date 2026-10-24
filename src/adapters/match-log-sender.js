// Where finished match logs go when sending is on (the Cloudflare Worker in cloudflare/match-log).
const MATCH_LOG_ENDPOINT = 'https://log.siegezeke.online/match-logs';
const BEACON_LIMIT = 60000;

// Fire and forget: a beacon survives the page closing; a larger log goes by fetch.
// text/plain keeps it a simple request, so no CORS preflight is needed.
export function sendMatchLog(log, { endpoint = MATCH_LOG_ENDPOINT, beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator),
  post = globalThis.fetch?.bind(globalThis) } = {}) {
  const body = JSON.stringify(log);
  const type = 'text/plain;charset=UTF-8';
  try {
    if (body.length <= BEACON_LIMIT && beacon?.(endpoint, new Blob([body], { type }))) return true;
    post?.(endpoint, { method: 'POST', body, headers: { 'content-type': type }, keepalive: body.length <= BEACON_LIMIT })?.catch?.(() => {});
    return Boolean(post);
  } catch { return false; }
}
