import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';

const store = () => { const items = new Map(); return { items, get: async key => items.get(key)?.value ?? null, put: async (key, value, options) => { items.set(key, { value, options }); } }; };
const log = { kind: 'siege-zeke.match-log', schemaVersion: 1, matchId: 'abc-123', endedAt: '2026-10-23T20:00:00.000Z',
  mode: 'ai', result: 'you', turns: 9, players: { you: {}, opponent: {} }, log: [] };
const post = (body, origin = 'https://siegezeke.online') => new Request('https://log.siegezeke.online/match-logs',
  { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain;charset=UTF-8', origin } });

test('a match log from the game is stored under its day and match', async () => {
  const env = { MATCH_LOGS: store() };
  const response = await worker.fetch(post(log), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://siegezeke.online');
  const saved = env.MATCH_LOGS.items.get('log/2026-10-23/abc-123');
  assert.deepEqual(JSON.parse(saved.value), log);
  assert.deepEqual(saved.options.metadata, { mode: 'ai', result: 'you', turns: 9 });
  assert.equal((await worker.fetch(post(log, 'http://127.0.0.1:5173'), env)).status, 204);
  assert.equal((await worker.fetch(post(log, 'https://siege-zeke-simple-public.pages.dev'), env)).status, 204);
  assert.equal((await worker.fetch(post(log, 'https://cb50cf4c.siege-zeke-simple-public.pages.dev'), env)).status, 204);
});

test('anything else is turned away without storing', async () => {
  const env = { MATCH_LOGS: store() };
  assert.equal((await worker.fetch(post(log, 'https://evil.example'), env)).status, 403);
  assert.equal((await worker.fetch(post(log, 'https://other-project.pages.dev'), env)).status, 403);
  assert.equal((await worker.fetch(post({ ...log, log: ['ロ'.repeat(100 * 1024)] }), env)).status, 413);
  assert.equal((await worker.fetch(post('{broken'), env)).status, 400);
  assert.equal((await worker.fetch(post({ ...log, kind: 'other' }), env)).status, 422);
  assert.equal((await worker.fetch(post({ ...log, matchId: '../x' }), env)).status, 422);
  assert.equal((await worker.fetch(post('x'.repeat(300 * 1024)), env)).status, 413);
  assert.equal((await worker.fetch(new Request('https://log.siegezeke.online/other', { method: 'POST' }), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://log.siegezeke.online/match-logs'), env)).status, 405);
  assert.equal(env.MATCH_LOGS.items.size, 0);
});

test('endedAt must start as an ISO day, so every stored key is one logs:pull can read', async () => {
  const env = { MATCH_LOGS: store() };
  for (const endedAt of ['Tue Oct 23 2026', 'Oct 23 2026 10:00', '2026-10-23', '2026-13-45T00:00:00Z', 12345])
    assert.equal((await worker.fetch(post({ ...log, endedAt }), env)).status, 422, String(endedAt));
  assert.equal(env.MATCH_LOGS.items.size, 0);
  assert.equal((await worker.fetch(post(log), env)).status, 204);
  assert.ok([...env.MATCH_LOGS.items.keys()].every(key => /^log\/\d{4}-\d{2}-\d{2}\/[\w-]{1,80}$/.test(key)));
});

test('metadata stays small and typed, and a KV failure answers 503 with CORS instead of crashing', async () => {
  const env = { MATCH_LOGS: store() };
  assert.equal((await worker.fetch(post({ ...log, mode: 'x'.repeat(5000), result: { a: 1 }, turns: 'many' }), env)).status, 204);
  assert.deepEqual(env.MATCH_LOGS.items.get('log/2026-10-23/abc-123').options.metadata, { mode: null, result: null, turns: null });
  const failing = { MATCH_LOGS: { get: async () => null, put: async () => { throw new Error('KV put failed'); } } };
  const response = await worker.fetch(post(log), failing);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://siegezeke.online');
});

test('a body without content-length is cut off at the cap, and a refused origin gets no allow-origin header', async () => {
  const env = { MATCH_LOGS: store() };
  let pulled = 0;
  const endless = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(64 * 1024)); } });
  const request = new Request('https://log.siegezeke.online/match-logs', { method: 'POST', body: endless, duplex: 'half',
    headers: { 'content-type': 'text/plain', origin: 'https://siegezeke.online' } });
  assert.equal(request.headers.get('content-length'), null);
  assert.equal((await worker.fetch(request, env)).status, 413);
  assert.ok(pulled < 10, 'the stream was abandoned, not read to the end');
  const chunked = new Request('https://log.siegezeke.online/match-logs', { method: 'POST', duplex: 'half', headers: { origin: 'https://siegezeke.online' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(log))); controller.close(); } }) });
  assert.equal((await worker.fetch(chunked, env)).status, 204);
  const refused = await worker.fetch(post(log, 'https://evil.example'), env);
  assert.equal(refused.status, 403);
  assert.equal(refused.headers.get('access-control-allow-origin'), null);
  assert.equal((await worker.fetch(new Request('https://log.siegezeke.online/other'), env)).headers.get('access-control-allow-origin'), null);
});

test('the first log kept for a match stays: the same body again is a success, a different one is a 409', async () => {
  const env = { MATCH_LOGS: store() };
  assert.equal((await worker.fetch(post(log), env)).status, 204);
  const key = 'log/2026-10-23/abc-123', first = env.MATCH_LOGS.items.get(key);
  assert.equal((await worker.fetch(post(log), env)).status, 204, 'a resend after a lost answer');
  const changed = await worker.fetch(post({ ...log, turns: 99 }), env);
  assert.equal(changed.status, 409);
  assert.equal(changed.headers.get('access-control-allow-origin'), 'https://siegezeke.online');
  assert.equal(env.MATCH_LOGS.items.get(key), first, 'the stored entry was not replaced');
  assert.equal((await worker.fetch(post({ ...log, matchId: 'other-match' }), env)).status, 204);
  assert.equal(env.MATCH_LOGS.items.size, 2);
  const unreadable = { MATCH_LOGS: { get: async () => { throw new Error('KV get failed'); }, put: async () => { throw new Error('must not write'); } } };
  assert.equal((await worker.fetch(post(log), unreadable)).status, 503);
});
