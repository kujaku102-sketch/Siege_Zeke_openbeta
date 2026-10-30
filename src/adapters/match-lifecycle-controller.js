import { createMatchSessionController, createNewMatchSessionController } from './match-session-controller.js';
import { loadTutorialCheckpoint } from './tutorial-checkpoint.js';
import { playTutorialToWin } from './tutorial-autoplay.js';

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
  const install = (created, runtimeConfig) => {
    if (!created.ok) return created;
    const next = created.value;
    try { if (current) retire(current); }
    catch (error) { next.dispose(); throw error; }
    current = next;
    config = structuredClone(runtimeConfig);
    generation += 1;
    return { ok: true, value: current };
  };
  const start = runtimeConfig => {
    if (disposed) return failure('MATCH_LIFECYCLE_DISPOSED');
    return install(createNewMatchSessionController({ runtimeConfig, sessionGeneration: generation + 1 }), runtimeConfig);
  };
  return Object.freeze({
    start,
    // Starts a tutorial as a new match from one of its stored checkpoints (tutorial-checkpoint.js): a new
    // match id, an empty journal and event feed, the guide where the checkpoint left it. The running match
    // is replaced like any other start; a rematch starts the same tutorial from its beginning.
    startFromCheckpoint({ file, checkpointId }) {
      if (disposed) return failure('MATCH_LIFECYCLE_DISPOSED');
      const loaded = loadTutorialCheckpoint(file, checkpointId, { matchId: nextMatchId() });
      if (!loaded.ok) return loaded;
      const { authority, tutorialState, runtimeConfig } = loaded.value;
      return install(createMatchSessionController({ authority, sessionGeneration: generation + 1, tutorialState }), runtimeConfig);
    },
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
    // Plays the current tutorial's own script on from wherever it stands, to its win: the opponent at STR 0,
    // the result locked for the player, the guide on the closing line. Same session, so the host keeps its handles.
    skipTutorialToWin() {
      if (!config || config.gameOptions.mode !== 'tutorial' || !current) return failure('UNAVAILABLE_MODE');
      const played = playTutorialToWin({ session: current });
      return played.ok ? { ok: true, value: current } : played;
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
