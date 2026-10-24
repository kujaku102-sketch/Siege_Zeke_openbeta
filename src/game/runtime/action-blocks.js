import { installCheck, normalExecutionCheck } from '../engine.js';
import { runtimePlanningReads } from './command-bridge.js';
import { createPlanningContext } from './planning-context.js';

// Why the standard hand routes are closed, as stable codes from the engine's own checks.
// Display only: legality is still legalActions, and nothing here is ever submitted.
const ROUTES = card => card.category === 'Plugin' ? ['install']
  : card.category === 'Sp' ? ['executeSpell', 'install'] : ['executeCard', 'install'];

function cardBlocks(context, legalActions) {
  const open = new Set(legalActions.map(action => `${action.base?.cardRef ?? action.action?.cardRef}:${action.actionType ?? action.action?.type}`));
  const view = context.view('normal');
  const blocks = [];
  for (const card of context.state.players[context.playerId].hand) {
    const cardRef = context.refFor(card);
    const cardView = cardRef && runtimePlanningReads.normalCardInView(view, card.uid);
    if (!cardView) continue;
    for (const actionType of ROUTES(cardView)) {
      if (open.has(`${cardRef}:${actionType}`)) continue;
      const check = actionType === 'install' ? installCheck(context.state, context.playerId, card.uid)
        : normalExecutionCheck(view, context.playerId, cardView, { zone: cardView.category === 'Script' ? 'back' : 'front' });
      // The engine allows the card itself, so no position or target makes it playable now.
      const code = check.ok ? 'NO_VALID_TARGET' : check.code ?? 'ACTION_UNAVAILABLE';
      blocks.push({ cardRef, actionType, code, ...(check.symbol ? { symbol: check.symbol } : {}) });
    }
  }
  return blocks;
}

export function buildRuntimeActionBlocks(authority, viewerSeat, requiredInput, legalActions, readContext = null, allowTutorial = false) {
  try {
    if (requiredInput !== null) return { ok: true, value: { general: 'INPUT_PENDING', cards: [] } };
    const context = createPlanningContext(authority, viewerSeat, readContext, allowTutorial);
    if (!context.allowed) {
      const { engine } = context;
      const general = engine.hasResult ? 'MATCH_FINISHED' : engine.busy ? 'RESOLVING'
        : engine.active !== context.playerId ? 'NOT_YOUR_TURN' : 'TUTORIAL_LOCKED';
      return { ok: true, value: { general, cards: [] } };
    }
    return { ok: true, value: { general: null, cards: cardBlocks(context, legalActions) } };
  } catch {
    return { ok: false, error: { code: 'ACTION_BLOCKS_INVALID_STATE' } };
  }
}
