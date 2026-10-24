import { createNewMatchSessionController } from './match-session-controller.js';

const failure = code => ({ ok: false, error: { code } });

// Host-level lifecycle, separate from a player's command port. Replacement
// validates the new match first, then revokes every old controller and handle.
// onRetire sees each session just before it is disposed, while it can still be read.
export function createMatchLifecycleController({ nextMatchId = () => crypto.randomUUID(), onRetire = null } = {}) {
  let current = null;
  let config = null;
  let generation = 0;
  let disposed = false;
  const retire = session => {
    try { onRetire?.(session); } catch { /* keeping a record never blocks leaving a match */ }
    session.dispose();
  };
  const start = runtimeConfig => {
    if (disposed) return failure('MATCH_LIFECYCLE_DISPOSED');
    const created = createNewMatchSessionController({ runtimeConfig, sessionGeneration: generation + 1 });
    if (!created.ok) return created;
    const next = created.value;
    try { if (current) retire(current); }
    catch (error) { next.dispose(); throw error; }
    current = next;
    config = structuredClone(runtimeConfig);
    generation += 1;
    return { ok: true, value: current };
  };
  return Object.freeze({
    start,
    current() { return !disposed && current ? { ok: true, value: current } : failure('MATCH_UNAVAILABLE'); },
    rematch() {
      if (!config) return failure('MATCH_UNAVAILABLE');
      return start({ ...structuredClone(config), matchId: nextMatchId() });
    },
    skipTutorial() {
      if (!config || config.gameOptions.mode !== 'tutorial') return failure('UNAVAILABLE_MODE');
      return start({ ...structuredClone(config), matchId: nextMatchId(),
        gameOptions: { ...structuredClone(config.gameOptions), mode: 'sandbox', sandboxDeckSetup: true } });
    },
    completeTutorial() {
      if (!config || config.gameOptions.mode !== 'tutorial' || !current) return failure('UNAVAILABLE_MODE');
      const tutorial = current.tutorial(), port = current.port(current.scope().seatIds[0]);
      const query = port.ok ? port.value.query() : port;
      if (!tutorial.ok || !tutorial.value.flow.complete || !query.ok || query.value.requiredInput !== null) return failure('ACTION_NOT_ALLOWED');
      return start({ ...structuredClone(config),matchId:nextMatchId(),
        gameOptions:{...structuredClone(config.gameOptions),mode:'sandbox',sandboxDeckSetup:true} });
    },
    leave() {
      if (disposed) return failure('MATCH_LIFECYCLE_DISPOSED');
      const previous = current; current = null; config = null;
      if (previous) retire(previous);
      return { ok: true, value: null };
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        const previous = current; current = null; config = null;
        if (previous) retire(previous);
      }
      return { ok: true, value: null };
    }
  });
}
