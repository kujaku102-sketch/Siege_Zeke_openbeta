import { canKeepOpeningHand, canOpeningMulligan, canActivateTurbo, supportsNormalScriptActivation, normalActivationBlocker } from '../engine.js';
import { runtimePlanningReads } from './command-bridge.js';
import { createPlanningContext } from './planning-context.js';
import { attackIntents } from './attack-planning.js';
import { executionIntents } from './execution-planning.js';

export function planningCatalog(context) {
  if (!context.allowed) return [];
  const { state, playerId } = context;
  const player = state.players[playerId];
  const actions = [];
  const add = action => actions.push({ kind: 'fixed', action });
  const mulligan = runtimePlanningReads.mulliganEligibilityView(state, playerId);
  const indexed = list => list.map((entry, index) => ({ actionId: `action:${context.revision}:${index + 1}`, ...entry }));
  if (mulligan.opening) {
    // Before the first turn the only decisions are keeping the hand or choosing cards to return.
    if (canKeepOpeningHand(mulligan, playerId)) add({ type: 'keepOpeningHand' });
    if (canOpeningMulligan(mulligan, playerId)) actions.push({ kind: 'intent', actionType: 'openingMulligan', base: {}, readiness: 'ready' });
    return indexed(actions);
  }
  if (context.metadata.startOptions.openingProtocol !== 'v2.4' && canOpeningMulligan(mulligan, playerId)) add({ type: 'openingMulligan' });
  if (canActivateTurbo(runtimePlanningReads.turboEligibilityView(state, playerId), playerId)) add({ type: 'activateAbility', ability: { kind: 'user', key: 'turbo' } });
  if (!player.registryActionUsed) {
    runtimePlanningReads.requireRegistryAction(state, playerId);
    for (const card of player.hand) { const cardRef = context.refFor(card); if (cardRef) add({ type: 'install', cardRef }); }
    for (const card of player.registry) { const cardRef = context.refFor(card); if (cardRef) add({ type: 'recoverRegistry', cardRef }); }
  }
  const normal = context.view('normal');
  for (const card of player.back) {
    const view = runtimePlanningReads.scriptEligibilityView(card);
    if (view.category !== 'Script' || !view.faceDown || view.declaredEffectId !== null
      || !supportsNormalScriptActivation(view) || view.cannotActivateTurn === state.turnNumber) continue;
    // memory, symbol and "nothing to carry the effect out" are the engine's own check (the one activateScript refuses by)
    const planned = runtimePlanningReads.normalCardInView(normal, card.uid);
    if (!planned || normalActivationBlocker(normal, playerId, planned)) continue;
    const cardRef = context.refFor(card);
    if (cardRef) add({ type: 'activateScript', cardRef });
  }
  actions.push(...executionIntents(context), ...attackIntents(context));
  add({ type: 'endTurn' });
  return indexed(actions);
}

export function buildRuntimeLegalActions(authority, viewerSeat, observation, requiredInput, readContext = null, allowTutorial = false) {
  try {
    if (requiredInput !== null) return { ok: true, value: [] };
    return { ok: true, value: planningCatalog(createPlanningContext(authority, viewerSeat, readContext, allowTutorial)) };
  } catch {
    return { ok: false, error: { code: 'LEGAL_ACTIONS_INVALID_STATE' } };
  }
}
