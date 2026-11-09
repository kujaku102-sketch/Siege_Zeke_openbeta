// How long a CPU takes to decide, and when that is too long.
// A decision is timed by createCpu (index.js) around the policy call. The monitor keeps the last WINDOW times and says "too slow" when the window is full enough and its median or 95th
// percentile is over the line. The lines are a first guess from the PC (lightZIG gen2: median 8.6 ms, 95% 43 ms; beatZIG gen2: 20 ms, 52 ms); they are to be set again from the numbers
// of real devices, which stats() hands out for the match log.
export const TIMING_LINES = Object.freeze({
  window: 20,        // the last decisions looked at
  warmup: 3,         // the first decisions of a match are not counted (the code is still being compiled)
  minSamples: 10,    // the median is judged from this many
  medianMs: 100,
  p95Ms: 250         // judged only when the window is full: with fewer samples the 95th percentile is the slowest one
});

const KEPT = 5000;   // all the times of a match are kept for stats() up to this many

// nearest rank: the smallest time that at least p of the times are not over
export function percentile(times, p) {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function createTimingMonitor(lines = {}) {
  const limit = { ...TIMING_LINES, ...lines };
  let counted = 0;
  let recent = [];
  let all = [];
  let slowest = 0;
  let seen = 0;
  const round = value => (value === null ? null : Math.round(value * 10) / 10);
  return {
    // returns { slow, median, p95 } for the window after this decision
    record(ms) {
      seen += 1;
      if (!Number.isFinite(ms) || ms < 0) return { slow: false, median: null, p95: null };
      slowest = Math.max(slowest, ms);
      if (seen <= limit.warmup) return { slow: false, median: null, p95: null };
      counted += 1;
      recent.push(ms);
      if (recent.length > limit.window) recent.shift();
      if (all.length < KEPT) all.push(ms);
      const median = recent.length >= limit.minSamples ? percentile(recent, 0.5) : null;
      const p95 = recent.length >= limit.window ? percentile(recent, 0.95) : null;
      return { slow: (median !== null && median > limit.medianMs) || (p95 !== null && p95 > limit.p95Ms), median: round(median), p95: round(p95) };
    },
    // the whole match so far, for the match log (one monitor for each CPU that played: createCpu makes a new one when it switches)
    stats() {
      return { n: counted, median: round(percentile(all, 0.5)), p95: round(percentile(all, 0.95)), max: round(slowest) };
    },
    lines: limit
  };
}
