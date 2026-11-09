import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMING_LINES, createTimingMonitor, percentile } from '../src/cpu/monitor.js';

test('percentile is the nearest rank', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([4, 3, 2, 1], 0.5), 2);
  assert.equal(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95), 19);
});

test('the first decisions are warm-up and are not counted', () => {
  const monitor = createTimingMonitor();
  for (let i = 0; i < TIMING_LINES.warmup; i += 1) assert.deepEqual(monitor.record(10000), { slow: false, median: null, p95: null });
  assert.equal(monitor.stats().n, 0);
  assert.equal(monitor.stats().max, 10000, 'the slowest decision is still seen');
});

test('a slow median is judged from ten decisions on, not before', () => {
  const monitor = createTimingMonitor({ warmup: 0 });
  for (let i = 0; i < 9; i += 1) assert.equal(monitor.record(400).slow, false);
  const tenth = monitor.record(400);
  assert.equal(tenth.slow, true);
  assert.equal(tenth.median, 400);
});

test('a CPU that is fast but for one slow decision is not too slow', () => {
  const monitor = createTimingMonitor({ warmup: 0 });
  let verdict;
  for (let i = 0; i < 19; i += 1) verdict = monitor.record(20);
  verdict = monitor.record(900);                      // the window is full: its 95th percentile is the second slowest, which is 20
  assert.equal(verdict.slow, false);
  assert.equal(verdict.p95, 20);
});

test('two slow decisions in a full window of fast ones make the 95th percentile slow', () => {
  const monitor = createTimingMonitor({ warmup: 0 });
  for (let i = 0; i < 18; i += 1) monitor.record(20);
  monitor.record(900);
  const verdict = monitor.record(900);
  assert.equal(verdict.slow, true);
  assert.equal(verdict.p95, 900);
  assert.equal(verdict.median, 20);
});

test('only the last window counts: a device that was slow and is fast again is not too slow', () => {
  const monitor = createTimingMonitor({ warmup: 0 });
  for (let i = 0; i < 5; i += 1) monitor.record(900);
  let verdict;
  for (let i = 0; i < 40; i += 1) verdict = monitor.record(20);
  assert.equal(verdict.slow, false);
});

test('a time that is not a number is ignored', () => {
  const monitor = createTimingMonitor({ warmup: 0 });
  assert.equal(monitor.record(Number.NaN).slow, false);
  assert.equal(monitor.record(-1).slow, false);
  assert.equal(monitor.stats().n, 0);
});

test('stats gives the whole match', () => {
  const monitor = createTimingMonitor({ warmup: 0 });
  for (const ms of [10, 20, 30, 40, 50]) monitor.record(ms);
  assert.deepEqual(monitor.stats(), { n: 5, median: 30, p95: 50, max: 50 });
});
