// The CPU of a match, chosen by name.
//
//   listCpus()                          what the player can choose from (catalog.js)
//   await preloadCpu(cpuId)             loads a learned CPU's code (it is split off the main bundle); call it before the match is mounted
//   createCpu({ cpuId, matchId, seatId, storage, now, onSwitch })
//                                       -> { ok: true, value: { policy, id(), stats(), switches(), onSwitch(listener) } }
//
// `policy` has the shape of the game's own CPU (simple-ai-policy.js): (query, commandId, queryAction, lookahead) => { ok, value: { commandId, expectedRevision, action } } or a failure.
// A learned CPU sees only the seat's query and the planner of its own port (queryAction), like the simple CPU; what it cannot decide (a spell, a window to answer, a board it has
// already tried) is handed to the simple CPU, which is how the frozen CPUs are made (view.baseline()).
// `lookahead` is session.lookahead(seat) (match-session-controller.js): for a CPU that reads ahead (beatZIG) the policy opens, only when it needs it, the states the reader may try moves
// on (view.sim, made by src/cpu/lookahead from what the seat has seen). A CPU that reads ahead and is not given it plays as the lighter one (reason 'no-lookahead'), never without its reader.
//
// Each decision is timed. When this device is too slow for the CPU (monitor.js), the CPU gives way to the next lighter one (catalog.js LIGHTER) for the rest of the match, the
// listeners are told, and the device remembers it (`simple-zeke.cpu-slow`) so that the next match starts with the lighter one. A learned CPU that throws is replaced the same way.
import { chooseSimpleAiIntent } from '../adapters/simple-ai-policy.js';
import { DEFAULT_CPU_ID, LIGHTER, catalogEntry, cpuAvailable, listCpus } from './catalog.js';
import { createTimingMonitor } from './monitor.js';

export { DEFAULT_CPU_ID, listCpus };
export const SLOW_HINT_KEY = 'simple-zeke.cpu-slow';

const loaded = new Map();            // cpu id -> the module's default export (a learned CPU: { id, create() })
let loadedHost = null;               // the lookahead host (src/cpu/lookahead), loaded with the first CPU that reads ahead

export async function preloadCpu(cpuId, { allowStale = false } = {}) {
  const entry = catalogEntry(cpuId);
  if (!entry || !cpuAvailable(entry, { allowStale })) return { ok: false, error: { code: 'CPU_NOT_AVAILABLE' } };
  if (!entry.learned || loaded.has(cpuId)) return { ok: true };
  try {
    const module = await entry.load();
    if (entry.needsLookahead) loadedHost ??= (await entry.loadLookahead()).lookaheadHost;
    loaded.set(cpuId, module.default);
    return { ok: true };
  } catch {
    return { ok: false, error: { code: 'CPU_LOAD_FAILED' } };
  }
}

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

function readHint(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SLOW_HINT_KEY) ?? 'null');
    return typeof value?.id === 'string' ? value.id : null;
  } catch { return null; }
}
function writeHint(storage, id) {
  try { storage?.setItem(SLOW_HINT_KEY, JSON.stringify({ id, at: new Date().toISOString() })); } catch { /* the device keeps nothing: the next match measures again */ }
}
export function clearSlowHint(storage) {
  try { storage?.removeItem(SLOW_HINT_KEY); } catch { /* nothing to clear */ }
}

// is `id` lighter than (or the same as) `limit`? walk down from `limit`
function atOrBelow(id, limit) {
  for (let step = limit; step !== null && step !== undefined; step = LIGHTER[step]) if (step === id) return true;
  return false;
}

// the function that plays one CPU: (query, commandId, queryAction) => result
function runnerFor(cpuId, seatId, modules, host) {
  const entry = catalogEntry(cpuId);
  if (!entry.learned) return chooseSimpleAiIntent;
  const module = modules[cpuId];
  if (!module) return null;
  const cpu = module.create();        // its own memory of the turn: one for each seat of each match
  return (query, commandId, queryAction, openLookahead) => {
    const view = { query, queryAction, commandId, seatId, baseline: () => chooseSimpleAiIntent(query, commandId, queryAction) };
    // The reader's states are opened when the CPU first asks for them, and not for a window to answer (the frozen CPU reads ahead on a move of its own turn only).
    if (entry.needsLookahead && query.requiredInput === null && typeof openLookahead === 'function') {
      let decision; let asked = false;
      Object.defineProperty(view, 'sim', { enumerable: true, get() { if (!asked) { asked = true; decision = openLookahead(host); } return decision ?? undefined; } });
    }
    return cpu.choose(view);
  };
}

export function createCpu({ cpuId = DEFAULT_CPU_ID, matchId = null, seatId = null, storage = null, clock = now, onSwitch = null, allowStale = false, lines = {}, cpuModules = null, lookaheadHost = null } = {}) {
  if (!catalogEntry(cpuId)) return { ok: false, error: { code: 'CPU_UNKNOWN' } };
  const listeners = onSwitch ? [onSwitch] : [];
  const switches = [];
  let currentId = cpuId;
  // cpuModules replaces what preloadCpu loaded (tests only)
  const modules = cpuModules ?? Object.fromEntries(loaded);
  const host = lookaheadHost ?? loadedHost;
  const usable = id => cpuAvailable(catalogEntry(id), { allowStale }) && (!catalogEntry(id).learned || Boolean(modules[id]) && (!catalogEntry(id).needsLookahead || Boolean(host)));
  const switchTo = (to, reason, detail = {}) => {
    const record = { from: currentId, to, reason, ...detail };
    switches.push(record);
    currentId = to;
    for (const listener of listeners) { try { listener(record); } catch { /* a listener's error is not the CPU's */ } }
  };
  // the choice is not usable (not offered for these rules, or its code is not loaded): the lighter one plays, and the player is told
  while (!usable(currentId) && LIGHTER[currentId] !== null && LIGHTER[currentId] !== undefined) {
    const to = LIGHTER[currentId];
    const reason = cpuAvailable(catalogEntry(currentId), { allowStale }) ? 'not-loaded' : 'not-available';
    switches.push({ from: currentId, to, reason }); currentId = to;
  }
  // this device was too slow for it before: start at the lighter one
  const hint = readHint(storage);
  if (hint && catalogEntry(hint) && !atOrBelow(currentId, hint)) {
    const to = hint;
    if (usable(to)) { switches.push({ from: currentId, to, reason: 'device-slow-before' }); currentId = to; }
  }
  let run = runnerFor(currentId, seatId, modules, host);
  let monitor = createTimingMonitor(lines);
  const history = [];                        // { id, stats } of the CPUs that have played, the current one last when stats() is read

  const lighter = (reason, detail = {}) => {
    const to = LIGHTER[currentId];
    if (to === null || to === undefined) return false;
    history.push({ id: currentId, ...monitor.stats() });
    const next = usable(to) ? to : (LIGHTER[to] ?? 'simple');
    if (reason === 'slow') writeHint(storage, next);
    switchTo(next, reason, detail);
    run = runnerFor(currentId, seatId, modules, host);
    monitor = createTimingMonitor(lines);
    return true;
  };

  const policy = (query, commandId, queryAction = null, openLookahead = null) => {
    // a CPU that reads ahead, given nothing to read ahead with, is not itself: the lighter one plays, and the player is told
    if (catalogEntry(currentId).needsLookahead && typeof openLookahead !== 'function') lighter('no-lookahead');
    const started = clock();
    let result;
    try {
      result = run(query, commandId, queryAction, openLookahead);
    } catch {
      // the learned CPU is replaced; this decision is the simple CPU's
      if (currentId !== 'simple') lighter('error');
      return chooseSimpleAiIntent(query, commandId, queryAction);
    }
    if (currentId !== 'simple') {
      const verdict = monitor.record(clock() - started);
      if (verdict.slow) lighter('slow', { median: verdict.median, p95: verdict.p95 });
    } else monitor.record(clock() - started);
    return result;
  };

  return { ok: true, value: {
    policy,
    id: () => currentId,
    chosen: cpuId,
    onSwitch: listener => { if (typeof listener === 'function') listeners.push(listener); },
    switches: () => switches.map(entry => ({ ...entry })),
    // for the match log: { chosen, played: [{ id, n, median, p95, max }...], switches: [...] }
    stats: () => ({ chosen: cpuId, matchId, seatId, played: [...history, { id: currentId, ...monitor.stats() }], switches: switches.map(entry => ({ ...entry })) })
  } };
}
