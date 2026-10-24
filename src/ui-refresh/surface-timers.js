// Timers of one mounted match. Every task is dropped once the match is disposed,
// and clear() cancels whatever is still pending.
export function createSurfaceTimers({ root, disposed, motionRemaining }) {
  const timers = new Set();
  const schedule = (task, delay) => {
    const token = setTimeout(() => { timers.delete(token); if (!disposed()) task(); }, delay);
    timers.add(token);
    return token;
  };
  const cancel = token => { clearTimeout(token); timers.delete(token); };
  // Opponent steps wait for the current move's motion; the token stays the same
  // across re-arming, so the controller's cancel still reaches it.
  const paced = (task, delay) => {
    const token = { timer: null };
    const arm = wait => { token.timer = schedule(() => {
      const left = motionRemaining();
      if (left > 0) arm(left + 160); else task();
    }, wait); };
    arm(delay);
    return token;
  };
  const cancelPaced = token => cancel(token.timer);
  const requestFrame = task => root.ownerDocument.defaultView?.requestAnimationFrame
    ? root.ownerDocument.defaultView.requestAnimationFrame(task)
    : schedule(task, 0);
  return Object.freeze({
    schedule, cancel, paced, cancelPaced, requestFrame,
    clear() { for (const timer of timers) clearTimeout(timer); timers.clear(); }
  });
}
