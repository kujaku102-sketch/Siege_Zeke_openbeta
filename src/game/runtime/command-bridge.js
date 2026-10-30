import { canonicalizeCommand, classifyCommand } from './command-record.js';
import { createActionRegistry, lookupActionHandler } from './action-registry.js';
import { SafeReadError } from './safe-read.js';
import { prepareAttackAction, attackPlanningView } from './command/attack-action.js';
import { authorityData, engineData, journalAfterAuthorization, journalSeatOrder, metadataData, publicAuthorityHeader } from './command/authority-data.js';
import { physicalCardMap } from './command/card-target.js';
import { CHOICE_ACTIONS, prepareChoiceAction } from './command/choice-action.js';
import { CommandBridgeError, exact, nonempty, own, reject, safeRevision } from './command/common.js';
import { prepareExecuteCardAction } from './command/execute-card-action.js';
import { executionCardView, executionPlanningView } from './command/execution-views.js';
import { layeredPlanningView, prepareExecuteLayeredAction } from './command/layered-action.js';
import { prepareNormalAction } from './command/normal-action.js';
import { normalCardInView, normalEffectEntries, normalPlanningView } from './command/normal-views.js';
import { OPENING_ACTIONS, mulliganEligibilityView, prepareKeepOpeningHandAction, prepareOpeningMulliganAction } from './command/opening-actions.js';
import { prepareRedeployAction, selectedLayerCount } from './command/redeploy-action.js';
import { prepareInstallAction, prepareRecoverRegistryAction, requireRegistryAction } from './command/registry-actions.js';
import { prepareRestSecurityAction } from './command/rest-security-action.js';
import { prepareSandboxAddAction, prepareSandboxSelectAction } from './command/sandbox-actions.js';
import { activationPlayerView, prepareActivateScriptAction, scriptEligibilityView } from './command/script-action.js';
import { prepareActivateAbilityAction, prepareEndTurnAction, turboEligibilityView } from './command/turn-actions.js';

// Internal planners and submit preparation use the same descriptor-safe views.
// These functions do not authorize, prepare, or apply a command.
export const runtimePlanningReads = Object.freeze({
  metadataData, engineData, physicalCardMap, executionPlanningView, executionCardView,
  layeredPlanningView, selectedLayerCount, attackPlanningView,
  requireRegistryAction, scriptEligibilityView, activationPlayerView,
  mulliganEligibilityView, turboEligibilityView, normalPlanningView, normalCardInView, normalEffectEntries
});

const ACTION_REGISTRY = createActionRegistry([
  { type: 'endTurn', requiresReferenceState: false, prepare: prepareEndTurnAction },
  { type: 'restSecurity', requiresReferenceState: true, prepare: prepareRestSecurityAction },
  { type: 'install', requiresReferenceState: true, prepare: prepareInstallAction },
  { type: 'recoverRegistry', requiresReferenceState: true, prepare: prepareRecoverRegistryAction },
  { type: 'activateScript', requiresReferenceState: true, prepare: prepareActivateScriptAction },
  { type: 'executeCard', requiresReferenceState: true, prepare: prepareExecuteCardAction },
  ...['executeSpell','mountCard','setScript','executeRegistry','activateCardEffect'].map(type => ({type,requiresReferenceState:true,prepare:prepareNormalAction})),
  { type: 'executeLayered', requiresReferenceState: true, prepare: prepareExecuteLayeredAction },
  { type: 'redeploy', requiresReferenceState: true, prepare: prepareRedeployAction },
  { type: 'attack', requiresReferenceState: true, prepare: prepareAttackAction },
  { type: 'openingMulligan', requiresReferenceState: false, prepare: prepareOpeningMulliganAction },
  { type: 'keepOpeningHand', requiresReferenceState: false, prepare: prepareKeepOpeningHandAction },
  { type: 'activateAbility', requiresReferenceState: false, prepare: prepareActivateAbilityAction },
  { type: 'sandboxAddCard', requiresReferenceState: false, prepare: prepareSandboxAddAction },
  { type: 'sandboxSelectActiveSeat', requiresReferenceState: false, prepare: prepareSandboxSelectAction },
  { type: 'answerChoice', requiresReferenceState: true, prepare: prepareChoiceAction },
  { type: 'declineChoice', requiresReferenceState: true, prepare: prepareChoiceAction }
]);

export function prepareRuntimeCommand(authority, context, envelope, { tutorialAuthorized = false } = {}) {
  try {
    const canonical = canonicalizeCommand(envelope);
    if (!canonical.ok) return canonical;
    const trusted = exact(context, ['matchId', 'actorSeat'], 'NOT_AUTHORIZED');
    if (!nonempty(trusted.matchId) || !nonempty(trusted.actorSeat) || trusted.matchId !== canonical.value.command.matchId
      || trusted.actorSeat !== canonical.value.command.actorSeat) reject('NOT_AUTHORIZED');

    const header = publicAuthorityHeader(authority);
    if (header.matchId !== trusted.matchId || !header.seatIds.includes(trusted.actorSeat)) reject('NOT_AUTHORIZED');

    const action = lookupActionHandler(ACTION_REGISTRY, canonical.value.command.action.type);
    if (!action) reject('ACTION_SCHEMA_UNAVAILABLE');
    const needsReferences = action.requiresReferenceState
      || action.type === 'openingMulligan' && Object.hasOwn(canonical.value.command.action, 'cardRefs');
    const journal = journalAfterAuthorization(authority, needsReferences);
    const classified = classifyCommand(journal, trusted, envelope);
    if (!classified.ok) return classified;
    if (classified.value.kind === 'retry') return { ok: true, value: classified.value };

    const source = needsReferences
      ? {
        metadata: own(authority, 'metadata', 'INVALID_AUTHORITY'),
        revision: own(authority, 'revision', 'INVALID_AUTHORITY'),
        engineState: own(authority, 'engineState', 'INVALID_AUTHORITY'),
        journal
      }
      : authorityData(authority);
    const metadata = metadataData(source.metadata);
    if (metadata.matchId !== trusted.matchId || !metadata.seatIds.includes(trusted.actorSeat)) reject('NOT_AUTHORIZED');
    const engine = engineData(source.engineState, metadata, action.type === 'restSecurity');
    journalSeatOrder(source.journal, metadata);
    if (!safeRevision(source.revision)) reject('INVALID_AUTHORITY');
    if (canonical.value.command.expectedRevision !== source.revision) reject('STALE_REVISION');
    if (source.revision === Number.MAX_SAFE_INTEGER) reject('REVISION_EXHAUSTED');
    const readReferenceState = () => own(authority, 'referenceState', 'INVALID_AUTHORITY');
    const preparation = { authority, source, engine, metadata, trusted, canonical, readReferenceState };
    if (['sandboxAddCard', 'sandboxSelectActiveSeat'].includes(action.type)) return action.prepare(preparation);
    if (CHOICE_ACTIONS.has(action.type)) return action.prepare(preparation);

    if (engine.mode === 'tutorial' && !tutorialAuthorized) reject('UNAVAILABLE_MODE');
    const playerId = engine.active;
    const activeSeat = metadata.seatIds[playerId === 'player' ? 0 : 1];
    if (trusted.actorSeat !== activeSeat) reject('ACTION_NOT_ALLOWED');
    if (engine.hasResult) reject('ACTION_NOT_ALLOWED');
    if (engine.busy) reject('ACTION_NOT_ALLOWED');
    // Before the first turn only the opening decisions exist; the engine refuses the rest too.
    if (engine.opening && !OPENING_ACTIONS.has(action.type)) reject('ACTION_NOT_ALLOWED');

    return action.prepare({ ...preparation, playerId });
  } catch (error) {
    if (error instanceof CommandBridgeError || error instanceof SafeReadError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}
