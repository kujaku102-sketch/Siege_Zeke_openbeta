import { createRuntimeClientController } from '../adapters/runtime-client-controller.js';
import { chooseSimpleAiIntent } from '../adapters/simple-ai-policy.js';
import { createTutorialOpponentController } from '../adapters/tutorial-opponent-controller.js';

// The other side of a mounted match: the simple AI seat and the tutorial opponent.
// Their steps are paced after the current motion and redraw the match when done.
// Returns a failed result, untouched, when either controller cannot be created.
export function createSurfaceOpponents({ session, scope, aiSeat, ui, paced, cancelPaced, current, onError, render }) {
  let cpu = null;
  let tutorialCpu = null;
  let cpuWake = null;
  let failedCpuWake = null;
  if (aiSeat !== null) {
    const port = session.port(aiSeat);
    if (!port.ok) return port;
    const controller = createRuntimeClientController({ port: port.value, policy: chooseSimpleAiIntent,
      scheduler: { schedule: task => paced(() => {
        if (!current()) return;
        let result;
        try { result = task(); }
        catch (error) { result = { ok: false, error: { code: error?.code ?? 'RUNTIME_CLIENT_THROW' } }; }
        if (!result?.ok || result.value?.kind === 'stopped') {
          failedCpuWake = cpuWake;
          onError(result?.error?.code ?? result?.value?.receipt?.receipt?.reasonCode ?? 'RUNTIME_CLIENT_STOPPED');
        }
        render(ui.read());
        return result;
      }, 420), cancel: cancelPaced } });
    if (!controller.ok) return controller;
    cpu = controller.value;
  }
  if (session.tutorial().ok) {
    const opponent = createTutorialOpponentController({session,seatId:scope.seatIds[1],scheduler:{
      schedule:task => paced(() => { if (!current()) return; let result;
        try { result = task(); }
        catch (error) { result = { ok:false,error:{code:error?.code ?? 'TUTORIAL_OPPONENT_THROW'} }; }
        if (!result?.ok && result?.error?.code !== 'TUTORIAL_OPPONENT_IDLE') onError(result?.error?.code ?? 'TUTORIAL_OPPONENT_FAILED');
        render(ui.read()); return result; },420),cancel:cancelPaced
    }});
    if (!opponent.ok) return opponent;
    tutorialCpu = opponent.value;
  }
  // The AI is woken once per distinct game position it may have to answer.
  const wakeKey = value => value ? [scope.matchId, scope.sessionGeneration, value.model.match.mode,
    value.sync?.modeEpoch ?? 0, value.model.match.revision, value.model.match.activeSeat,
    value.model.match.progress, value.model.requiredInput?.choiceId ?? 'none',
    value.model.requiredInput?.actorSeat ?? 'none', value.model.requiredInput?.canAnswer ?? 'none'].join(':') : null;
  return { ok: true, value: Object.freeze({
    startCpu(latest) {
      const wake = wakeKey(latest);
      if (!cpu || !wake || wake === cpuWake || wake === failedCpuWake) return;
      const started = cpu.start();
      if (!started.ok) { failedCpuWake = wake; onError(started.error.code); return; }
      cpuWake = wake;
    },
    startTutorial() { tutorialCpu?.start(); },
    startAi() { return cpu?.start() ?? { ok: true, value: { kind: 'idle' } }; },
    dispose() { cpu?.dispose(); tutorialCpu?.dispose(); }
  }) };
}
