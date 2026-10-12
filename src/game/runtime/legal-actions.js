import { canOpeningMulligan, canActivateTurbo, supportsNormalScriptActivation, enabledSymbols } from '../engine.js';
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
  if (canOpeningMulligan(runtimePlanningReads.mulliganEligibilityView(state, playerId), playerId)) add({ type: 'openingMulligan' });
  if (canActivateTurbo(runtimePlanningReads.turboEligibilityView(state, playerId), playerId)) add({ type: 'activateAbility', ability: { kind: 'user', key: 'turbo' } });
  if (!player.registryActionUsed) {
    runtimePlanningReads.requireRegistryAction(state, playerId);
    for (const card of player.hand) { const cardRef = context.refFor(card); if (cardRef) add({ type: 'install', cardRef }); }
    for (const card of player.registry) { const cardRef = context.refFor(card); if (cardRef) add({ type: 'recoverRegistry', cardRef }); }
  }
  for (const card of player.back) {
    const view = runtimePlanningReads.scriptEligibilityView(card);
    if (view.category !== 'Script' || !view.faceDown || view.declaredEffectId !== null
      || !supportsNormalScriptActivation(view) || view.cannotActivateTurn === state.turnNumber) continue;
    const activation = runtimePlanningReads.activationPlayerView(state, playerId, context.engine.mode !== 'lab' && Boolean(view.color));
    if (activation.memory < (view.activationCost ?? view.cost ?? 0)
      || context.engine.mode !== 'lab' && view.color && !enabledSymbols(activation).includes(view.color)) continue;
    const cardRef = context.refFor(card);
    if (cardRef) add({ type: 'activateScript', cardRef });
  }
  actions.push(...executionIntents(context), ...attackIntents(context));
  add({ type: 'endTurn' });
  return actions.map((entry, index) => ({ actionId: `action:${context.revision}:${index + 1}`, ...entry }));
}

export function buildRuntimeLegalActions(authority, viewerSeat, observation, requiredInput, readContext = null, allowTutorial = false) {
  try {
    if (requiredInput !== null) return { ok: true, value: [] };
    return { ok: true, value: planningCatalog(createPlanningContext(authority, viewerSeat, readContext, allowTutorial)) };
  } catch {
    return { ok: false, error: { code: 'LEGAL_ACTIONS_INVALID_STATE' } };
  }
}
