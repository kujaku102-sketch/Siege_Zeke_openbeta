import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, BACKOFF, createReconnector } from '../src/network/reconnect.js';
import { isOnlineAvailable, onlineEndpoint, roomsUrl, roomSocketUrl } from '../src/network/endpoint.js';

test('the pause before a retry doubles up to a cap, with a quarter of jitter either way', () => {
  const middle = () => 0.5;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(attempt => backoffDelay(attempt, middle)), [500, 1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(backoffDelay(3, () => 0), 1500);
  assert.equal(backoffDelay(3, () => 1), 2500);
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const delay = backoffDelay(attempt);
    const base = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** (attempt - 1));
    assert.ok(delay >= base * 0.75 - 1 && delay <= base * 1.25 + 1, `${attempt}: ${delay}`);
  }
});

// A clock and a timer the test moves by hand.
function world() {
  let time = 0, next = 1;
  const timers = new Map();
  return {
    now: () => time,
    after: (ms, fn) => { const id = next++; timers.set(id, { at: time + ms, fn }); return id; },
    cancel: id => { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = time + ms;
      await new Promise(resolve => setImmediate(resolve));
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn();
        await new Promise(resolve => setImmediate(resolve));
      }
      time = end;
    }
  };
}

test('it connects at once when it can, and reports every step', async () => {
  const w = world(), seen = [];
  const reconnector = createReconnector({ connect: async () => true, onStatus: status => seen.push(status.status), now: w.now, after: w.after, cancel: w.cancel, random: () => 0.5 });
  reconnector.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen, ['trying', 'connected']);
  assert.equal(reconnector.running(), false);
});

test('it keeps trying with growing pauses until a try works', async () => {
  const w = world(), statuses = [];
  let calls = 0;
  const reconnector = createReconnector({ connect: async () => ++calls >= 4, onStatus: status => statuses.push([status.status, status.attempt, status.retryInMs]),
    now: w.now, after: w.after, cancel: w.cancel, random: () => 0.5 });
  reconnector.start();
  await w.advance(0); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(statuses.at(-1), ['waiting', 1, 500]);
  await w.advance(500);
  assert.deepEqual(statuses.at(-1), ['waiting', 2, 1000]);
  await w.advance(1000 + 2000);
  assert.deepEqual(statuses.at(-1), ['connected', 4, null]);
  assert.equal(calls, 4);
});

test('a connect that throws counts as a failed try', async () => {
  const w = world();
  let calls = 0;
  const reconnector = createReconnector({ connect: async () => { if (++calls < 3) throw new Error('refused'); return true; }, now: w.now, after: w.after, cancel: w.cancel, random: () => 0.5 });
  reconnector.start();
  await w.advance(10_000);
  assert.equal(calls, 3);
  assert.equal(reconnector.running(), false);
});

test('it gives up after 75 seconds in a match and 20 seconds before one', async () => {
  for (const [phase, budget] of [['playing', 75_000], ['lobby', 20_000]]) {
    const w = world(), statuses = [];
    const reconnector = createReconnector({ connect: async () => false, phase: () => phase, onStatus: status => statuses.push(status.status),
      now: w.now, after: w.after, cancel: w.cancel, random: () => 0.5 });
    reconnector.start();
    await w.advance(budget + 20_000);
    assert.equal(statuses.at(-1), 'gave-up', phase);
    assert.equal(reconnector.running(), false);
    assert.equal(w.pending(), 0);
    assert.ok(w.now() >= budget);
  }
});

test('stop cancels the wait, and a second start while running does nothing', async () => {
  const w = world();
  let calls = 0;
  const reconnector = createReconnector({ connect: async () => { calls += 1; return false; }, now: w.now, after: w.after, cancel: w.cancel, random: () => 0.5 });
  reconnector.start(); reconnector.start();
  await w.advance(0);
  assert.equal(calls, 1);
  reconnector.stop();
  assert.equal(w.pending(), 0);
  await w.advance(60_000);
  assert.equal(calls, 1);
  assert.equal(reconnector.running(), false);
});

test('the server address comes from one place; only a page on this PC may point elsewhere', () => {
  assert.equal(onlineEndpoint({ hostname: 'siegezeke.online', search: '', configured: '' }), null, 'unset: online play stays "not ready"');
  assert.equal(isOnlineAvailable({ hostname: 'siegezeke.online', configured: '' }), false);
  assert.equal(onlineEndpoint({ hostname: 'localhost', search: '?online=http://127.0.0.1:8801' }), 'http://127.0.0.1:8801');
  assert.equal(onlineEndpoint({ hostname: '127.0.0.1', search: '?online=https://play.example.test/some/path' }), 'https://play.example.test');
  assert.equal(onlineEndpoint({ hostname: 'siegezeke.online', search: '?online=https://evil.example', configured: 'https://play.siegezeke.online' }), 'https://play.siegezeke.online', 'a shared link cannot redirect players');
  assert.equal(onlineEndpoint({ hostname: 'localhost', search: '?online=ftp://x' }), null);
  assert.equal(onlineEndpoint({ hostname: 'localhost', search: '?online=http://evil.example' }), null, 'plain http only for this PC');
  assert.equal(onlineEndpoint({ hostname: 'localhost', search: '?online=nonsense' }), null);
  assert.equal(onlineEndpoint({ hostname: 'siegezeke.online', configured: 'https://play.siegezeke.online/' }), 'https://play.siegezeke.online');
  assert.equal(onlineEndpoint({ hostname: 'siegezeke.online', configured: 'http://play.siegezeke.online' }), null);
  assert.equal(isOnlineAvailable({ hostname: 'localhost', search: '?online=http://localhost:8801' }), true);
});

test('socket and room addresses are built from the endpoint', () => {
  assert.equal(roomSocketUrl('https://play.siegezeke.online', 'K7M2QXAB'), 'wss://play.siegezeke.online/rooms/K7M2QXAB/ws');
  assert.equal(roomSocketUrl('http://127.0.0.1:8801', 'K7M2QXAB'), 'ws://127.0.0.1:8801/rooms/K7M2QXAB/ws');
  assert.equal(roomsUrl('https://play.siegezeke.online'), 'https://play.siegezeke.online/rooms');
});
