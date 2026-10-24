import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';

const store = () => { const items = new Map(); return { items, put: async (key, value, options) => { items.set(key, { value, options }); } }; };
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
