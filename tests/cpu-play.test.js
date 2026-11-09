import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { SLOW_HINT_KEY, clearSlowHint, createCpu, listCpus, preloadCpu } from '../src/cpu/index.js';

const runtimeConfig = (matchId, seed, playerDeckId = 'red', aiDeckId = 'yellow') => ({ matchId, seatIds: ['player', 'ai'], seed, ruleVersion: '2.0', cardVersion: 'public',
  gameOptions: { mode: 'ai', playerDeckId, aiDeckId, playerUserId: 'doors_zx', aiUserId: 'doors_zx' } });

// A seat's decision, from its own port: what the UI's CPU controller does.
function playOut(session, policies, steps) {
  let serial = 0; let accepted = 0; const failures = [];
  for (let step = 0; step < steps; step += 1) {
    let seat = 'player'; let port = session.port(seat).value; let query = port.query().value;
    if (query.status.finished) return { finished: true, accepted, failures };
    if (query.requiredInput ? !query.requiredInput.canAnswer : query.status.activeSeat !== 'player') { seat = 'ai'; port = session.port(seat).value; query = port.query().value; }
    const intent = policies[seat](query, `cpu:${seat}:${++serial}`, input => port.queryAction(input));
    if (!intent.ok) { failures.push({ seat, code: intent.error?.code }); return { finished: false, accepted, failures }; }
    const receipt = port.submit(intent.value);
    if (!receipt.ok) { failures.push({ seat, code: receipt.error?.code }); return { finished: false, accepted, failures }; }
    accepted += 1;
  }
  return { finished: session.port('player').value.query().value.status.finished, accepted, failures };
}

const memoryStorage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data }; };
const steadyClock = (ms) => { let t = 0; let phase = 0; return () => { phase += 1; if (phase % 2 === 1) return t; t += ms; return t; }; };   // each decision (a start and an end) takes `ms`

test('the catalog hands out names with a short description; the simple CPU plays by default', () => {
  const cpus = listCpus();
  assert.deepEqual(cpus.map(entry => entry.id), ['simple', 'lightZIG']);
  for (const entry of cpus) { assert.ok(entry.name); assert.ok(entry.description.length > 0 && entry.description.length < 80); }
  const made = createCpu({});
  assert.equal(made.ok, true);
  assert.equal(made.value.id(), 'simple');
  assert.equal(createCpu({ cpuId: 'nope' }).ok, false);
});

test('a learned CPU whose rules are not the game\'s gives way to the simple CPU, and says so', () => {
  const made = createCpu({ cpuId: 'lightZIG' });
  assert.equal(made.ok, true);
  assert.equal(made.value.id(), 'simple');
  assert.deepEqual(made.value.switches().map(({ from, to, reason }) => ({ from, to, reason })), [{ from: 'lightZIG', to: 'simple', reason: 'not-available' }]);
});

test('a learned CPU whose code is not loaded gives way to the simple CPU', () => {
  const made = createCpu({ cpuId: 'lightZIG', allowStale: true, cpuModules: {} });
  assert.equal(made.value.id(), 'simple');
  assert.equal(made.value.switches()[0].reason, 'not-loaded');
});

test('lightZIG plays a whole match against the simple CPU through the local runtime, with no refused command', async () => {
  assert.equal((await preloadCpu('lightZIG')).ok, false, 'not offered for these rules');
  assert.equal((await preloadCpu('lightZIG', { allowStale: true })).ok, true);
  for (const [seed, deck] of [[4242, 'red'], [77, 'yellow']]) {
    const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig(`cpu-light-${seed}`, seed, deck, deck === 'red' ? 'yellow' : 'red') });
    assert.equal(made.ok, true, JSON.stringify(made));
    const cpu = createCpu({ cpuId: 'lightZIG', allowStale: true, matchId: `cpu-light-${seed}`, seatId: 'player', clock: steadyClock(5) });
    assert.equal(cpu.value.id(), 'lightZIG');
    const result = playOut(made.value, { player: cpu.value.policy, ai: chooseSimpleAiIntent }, 1500);
    assert.deepEqual(result.failures, []);
    assert.equal(result.finished, true, `seed ${seed} did not finish in ${result.accepted} commands`);
    assert.ok(result.accepted > 20);
    assert.equal(cpu.value.id(), 'lightZIG', 'not too slow, not replaced');
    const stats = cpu.value.stats();
    assert.equal(stats.played.length, 1);
    assert.equal(stats.played[0].id, 'lightZIG');
    assert.ok(stats.played[0].n > 10);
  }
});

test('a CPU that is too slow on this device gives way to the lighter one for the rest of the match, and the device remembers', async () => {
  await preloadCpu('lightZIG', { allowStale: true });
  const storage = memoryStorage();
  const heard = [];
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('cpu-slow', 4242) });
  const cpu = createCpu({ cpuId: 'lightZIG', allowStale: true, seatId: 'player', storage, clock: steadyClock(400), onSwitch: record => heard.push(record) });
  const result = playOut(made.value, { player: cpu.value.policy, ai: chooseSimpleAiIntent }, 1500);
  assert.deepEqual(result.failures, []);
  assert.equal(result.finished, true);
  assert.equal(cpu.value.id(), 'simple');
  assert.equal(heard.length, 1);
  assert.deepEqual({ from: heard[0].from, to: heard[0].to, reason: heard[0].reason }, { from: 'lightZIG', to: 'simple', reason: 'slow' });
  assert.equal(heard[0].median, 400);
  assert.deepEqual(cpu.value.stats().played.map(entry => entry.id), ['lightZIG', 'simple']);
  assert.ok(JSON.parse(storage.data.get(SLOW_HINT_KEY)).id === 'simple');

  // the next match on this device starts with the lighter one
  const next = createCpu({ cpuId: 'lightZIG', allowStale: true, storage });
  assert.equal(next.value.id(), 'simple');
  assert.equal(next.value.switches()[0].reason, 'device-slow-before');
  clearSlowHint(storage);
  assert.equal(createCpu({ cpuId: 'lightZIG', allowStale: true, storage }).value.id(), 'lightZIG');
});

test('a device that keeps nothing (storage that throws) still plays', async () => {
  await preloadCpu('lightZIG', { allowStale: true });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const cpu = createCpu({ cpuId: 'lightZIG', allowStale: true, storage: broken, clock: steadyClock(400) });
  assert.equal(cpu.value.id(), 'lightZIG');
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('cpu-broken', 9) });
  const result = playOut(made.value, { player: cpu.value.policy, ai: chooseSimpleAiIntent }, 1500);
  assert.deepEqual(result.failures, []);
  assert.equal(cpu.value.id(), 'simple');
});

test('a learned CPU that throws is replaced by the simple CPU and the decision is still answered', () => {
  const failing = { create: () => ({ choose() { throw new Error('boom'); } }) };
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('cpu-throws', 4242) });
  const cpu = createCpu({ cpuId: 'lightZIG', allowStale: true, cpuModules: { lightZIG: failing } });
  assert.equal(cpu.value.id(), 'lightZIG');
  const result = playOut(made.value, { player: cpu.value.policy, ai: chooseSimpleAiIntent }, 1500);
  assert.deepEqual(result.failures, []);
  assert.equal(result.finished, true);
  assert.equal(cpu.value.id(), 'simple');
  assert.equal(cpu.value.switches()[0].reason, 'error');
});
