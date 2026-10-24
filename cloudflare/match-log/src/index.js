// Receives finished match logs from the game and keeps each one in KV.
// Only logs the game itself sends are accepted: the right kind, a sane size,
// and a page from an allowed origin. Nothing about the sender is stored.
const KIND = 'siege-zeke.match-log';
const MAX_BYTES = 256 * 1024;
// The site, its Pages address and preview deployments (<hash>.siege-zeke-simple-public.pages.dev), and local dev.
const ALLOWED_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*siegezeke\.online$/, /^https:\/\/([a-z0-9-]+\.)?siege-zeke-simple-public\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

// A refused origin gets no allow-origin header at all, rather than a wildcard.
const cors = origin => ({ ...(origin ? { 'access-control-allow-origin': origin } : {}), 'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type', vary: 'origin' });
const reply = (status, origin, body = null) => new Response(body, { status, headers: cors(origin) });

// The day in the KV key comes straight from endedAt, so it must start as YYYY-MM-DD (the game sends toISOString()).
// Date.parse alone also takes "Tue Oct 23 2026", whose first ten characters would make a key logs:pull never reads.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}T/;

// KV metadata is capped at 1 KiB and a put over it throws, so only short plain values are kept.
const short = value => typeof value === 'string' && value.length <= 16 ? value : null;
const metadataOf = log => ({ mode: short(log.mode), result: short(log.result), turns: Number.isSafeInteger(log.turns) ? log.turns : null });

// Reads the body up to the cap even when no content-length was sent (a chunked body can be any size).
async function readText(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function validLog(log) {
  return log?.kind === KIND && log.schemaVersion === 1 && typeof log.matchId === 'string' && /^[\w-]{1,80}$/.test(log.matchId)
    && typeof log.endedAt === 'string' && ISO_DAY.test(log.endedAt) && !Number.isNaN(Date.parse(log.endedAt)) && Array.isArray(log.log)
    && log.players && typeof log.players === 'object';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = origin && ALLOWED_ORIGINS.some(pattern => pattern.test(origin)) ? origin : null;
    if (url.pathname !== '/match-logs') return reply(404, allowed);
    if (request.method === 'OPTIONS') return reply(allowed ? 204 : 403, allowed);
    if (request.method !== 'POST') return reply(405, allowed);
    if (!allowed) return reply(403, null);
    const size = Number(request.headers.get('content-length') ?? 0);
    if (size > MAX_BYTES) return reply(413, allowed);
    const text = await readText(request);
    if (text === null) return reply(413, allowed);
    let log;
    try { log = JSON.parse(text); } catch { return reply(400, allowed); }
    if (!validLog(log)) return reply(422, allowed);
    // One key per match, grouped by the day it ended; a resend of the same match overwrites it.
    const key = `log/${log.endedAt.slice(0, 10)}/${log.matchId}`;
    try { await env.MATCH_LOGS.put(key, text, { metadata: metadataOf(log) }); } catch { return reply(503, allowed); }
    return reply(204, allowed);
  }
};
