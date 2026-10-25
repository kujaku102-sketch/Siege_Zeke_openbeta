// Where finished match logs go when sending is on (the Cloudflare Worker in cloudflare/match-log).
export const MATCH_LOG_ENDPOINT = 'https://log.siegezeke.online/match-logs';
// Browsers cap a beacon, and a keepalive fetch, at 64 KiB of body bytes; leave room for headers.
const BEACON_LIMIT = 60000;
const RETRY_DELAY_MS = 3000;

// A failed send is tried once more when the cause may pass: no answer, a timeout, or a Worker/KV error.
// Anything else is final: 2xx saved; 409 means the Worker already holds a log for this match (our first try
// landed but its answer was lost); 4xx like 403, 413, 422 would fail again; 429 is the rate limit, which a quick retry only feeds.
const retryable = status => status === 408 || status >= 500;

// Fire and forget. A small log goes by keepalive fetch, which survives the page closing like a beacon
// but also reports how it went, so one failure can be retried; a larger log goes by a plain fetch.
// Without fetch a small log falls back to a beacon (no answer to look at, so no retry).
// The limit is in UTF-8 bytes, since a Japanese log is about three bytes a character.
// text/plain keeps it a simple request, so no CORS preflight is needed.
// The result only says the log was handed to the network; the retry runs later if the page is still open.
export function sendMatchLog(log, { endpoint = MATCH_LOG_ENDPOINT, beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator),
  post = globalThis.fetch?.bind(globalThis), schedule = globalThis.setTimeout?.bind(globalThis), retryDelay = RETRY_DELAY_MS } = {}) {
  try {
    const body = JSON.stringify(log);
    const type = 'text/plain;charset=UTF-8';
    const small = new TextEncoder().encode(body).length <= BEACON_LIMIT;
    if (!post) return Boolean(small && beacon?.(endpoint, new Blob([body], { type })));
    // true once there is nothing left to try for this log.
    const attempt = async () => {
      try {
        const response = await post(endpoint, { method: 'POST', body, headers: { 'content-type': type }, keepalive: small });
        return !retryable(response?.status);
      } catch { return false; }
    };
    attempt().then(done => { if (!done) schedule?.(() => { attempt(); }, retryDelay); });
    return true;
  } catch { return false; }
}
