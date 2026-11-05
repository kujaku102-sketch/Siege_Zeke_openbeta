// Reconnecting a dropped socket (design: サーバー設計-詳細.md §5.4, §7). Pure: the clock, the timer and the randomness are passed in.
//
// The room gives a guest 60 seconds; the client keeps trying a little longer than that, with growing pauses, then reports "down".
// A room that has not started yet is not worth as long a wait: its code expires anyway.
export const BACKOFF = Object.freeze({
  baseMs: 500, factor: 2, maxMs: 8000, jitter: 0.25,
  giveUpAfterMs: { playing: 75_000, lobby: 20_000 }
});

// The pause before attempt number `attempt` (1 is the first retry), with jitter in [-jitter, +jitter].
export function backoffDelay(attempt, random = Math.random, policy = BACKOFF) {
  const base = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt - 1));
  const spread = (random() * 2 - 1) * policy.jitter;
  return Math.max(0, Math.round(base * (1 + spread)));
}

// Calls connect() until it succeeds, the budget runs out, or stop() is called.
//   connect()   Promise<boolean>   true once a socket is open and the room has said welcome; false (or a throw) to try again
//   onStatus    ({ status: 'trying' | 'waiting' | 'connected' | 'gave-up', attempt, retryInMs })
//   phase()     'playing' | 'lobby'  which budget applies (read at each failure)
// Returns { start(), stop(), running() }.
export function createReconnector({ connect, onStatus = () => {}, phase = () => 'playing', now = () => Date.now(),
  after = (ms, fn) => setTimeout(fn, ms), cancel = handle => clearTimeout(handle), random = Math.random, policy = BACKOFF }) {
  let running = false;
  let handle = null;
  let startedAt = 0;
  let attempt = 0;
  let epoch = 0;

  const give = status => { try { onStatus(status); } catch { /* a listener must not stop the retry */ } };

  async function tryOnce(mine) {
    attempt += 1;
    give({ status: 'trying', attempt, retryInMs: null });
    let connected = false;
    try { connected = Boolean(await connect()); } catch { connected = false; }
    if (mine !== epoch || !running) return;
    if (connected) { running = false; give({ status: 'connected', attempt, retryInMs: null }); return; }
    const budget = policy.giveUpAfterMs[phase()] ?? policy.giveUpAfterMs.playing;
    const delay = backoffDelay(attempt, random, policy);
    if (now() - startedAt + delay > budget) { running = false; give({ status: 'gave-up', attempt, retryInMs: null }); return; }
    give({ status: 'waiting', attempt, retryInMs: delay });
    handle = after(delay, () => { handle = null; tryOnce(mine); });
  }

  return Object.freeze({
    start() {
      if (running) return;
      running = true;
      epoch += 1;
      attempt = 0;
      startedAt = now();
      tryOnce(epoch);
    },
    stop() {
      running = false;
      epoch += 1;
      if (handle !== null) { cancel(handle); handle = null; }
    },
    running: () => running
  });
}
