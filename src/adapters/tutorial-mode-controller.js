import { createTutorialFlow, currentTutorialPresentation, currentTutorialStep,
  advanceTutorialIntroduction, tutorialSteps, matches, TUTORIAL_OPPONENT_SCRIPTS } from '../data/tutorial-script.js';

const failure = code => ({ ok: false, error: { code } });
function visibleCards(query) {
  const cards = [];
  const visit = card => { cards.push(card); if (!card.faceDown) card.mounted.forEach(visit); };
  for (const seat of query.observation.seats) {
    seat.hand.cards?.forEach(visit);
    for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) seat[zone].cards.forEach(visit);
  }
  return cards;
}

export function createTutorialModeController(tutorialId = 'basics') {
  const flow = createTutorialFlow(tutorialId);
  let acceptedAction = null;
  let opponentScript = null;
  let opponentIndex = 0;
  let opponentActionPending = false;
  let disposed = false;
  const stepFinished = () => {
    const step = currentTutorialStep(flow);
    opponentScript = step.after ?? null;
    opponentIndex = 0;
    flow.index += 1;
    flow.complete = flow.index >= tutorialSteps(tutorialId).length - 1;
    acceptedAction = null;
  };
  return Object.freeze({
    presentation() { return structuredClone({ flow, presentation: currentTutorialPresentation(flow), opponentScript, opponentIndex }); },
    advance() {
      if (disposed) return failure('TUTORIAL_DISPOSED');
      if (!flow.introComplete) advanceTutorialIntroduction(flow);
      else if (currentTutorialStep(flow).expect?.type === 'advance') stepFinished();
      else return failure('TUTORIAL_ACTION_NOT_EXPECTED');
      return { ok: true, value: null };
    },
    authorize(query, action) {
      if (disposed) return failure('TUTORIAL_DISPOSED');
      if (['answerChoice', 'declineChoice'].includes(action.type)) return { ok: true, value: null };
      const playerSeat = query.observation.seats[0].seatId;
      const cards = visibleCards(query);
      const card = cards.find(item => item.cardRef === (action.cardRef ?? action.attackerRef));
      const target = cards.find(item => item.cardRef === (action.target?.cardRef ?? action.targets?.[0]?.cardRef));
      const host = cards.find(item => item.cardRef === (action.hostRef ?? action.placement?.hostRef));
      const semantic = {
        type: ({ executeCard: 'play',executeSpell:'play',mountCard:'play',setScript:'play',executeRegistry:'registry-execute',activateCardEffect:'activate-effect',
          executeLayered: 'layered', redeploy: 'relog', recoverRegistry:'registry-recover',
          endTurn: 'end-turn', activateAbility: 'turbo', activateScript: 'script-activate' })[action.type] ?? action.type,
        cardId: card?.faceDown ? null : card?.definition.id,
        zone: action.destination?.zone ?? action.targetZone ?? action.placement?.zone ?? host?.location?.zone,
        targetType: action.target?.kind === 'user' ? 'fortress' : action.target?.kind,
        targetCardId: target?.faceDown ? null : target?.definition.id
      };
      if (query.status.viewerSeat !== playerSeat) {
        const original = TUTORIAL_OPPONENT_SCRIPTS[opponentScript]?.[opponentIndex];
        const expected = original ? {...original,type:({executeCard:'play',endTurn:'end-turn'})[original.type] ?? original.type} : null;
        return expected && !opponentActionPending && matches(expected, semantic)
          ? { ok: true, value: null } : failure('TUTORIAL_ACTION_NOT_EXPECTED');
      }
      if (!flow.introComplete || acceptedAction || opponentScript) return failure('TUTORIAL_ACTION_NOT_EXPECTED');
      return matches(currentTutorialStep(flow).expect, semantic)
        ? { ok: true, value: null } : failure('TUTORIAL_ACTION_NOT_EXPECTED');
    },
    accepted(query, action) {
      if (disposed) return;
      const playerSeat = query.observation.seats[0].seatId;
      if (query.status.viewerSeat !== playerSeat && !['answerChoice', 'declineChoice'].includes(action.type)) opponentActionPending = true;
      if (query.status.viewerSeat === playerSeat && !['answerChoice', 'declineChoice'].includes(action.type)) {
        acceptedAction = structuredClone(action);
      }
      if (acceptedAction && query.requiredInput === null && query.status.progress !== 'resultLocked') stepFinished();
      if (opponentActionPending && query.requiredInput === null) {
        opponentIndex += 1;
        opponentActionPending = false;
      }
      if (opponentScript && query.status.activeSeat === playerSeat && query.requiredInput === null) opponentScript = null;
    },
    dispose() { disposed = true; acceptedAction = null; opponentScript = null; }
  });
}
