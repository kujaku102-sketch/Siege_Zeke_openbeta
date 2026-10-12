import { createRuntimeClientController } from './runtime-client-controller.js';
import { chooseSimpleAiIntent } from './simple-ai-policy.js';
import { TUTORIAL_OPPONENT_SCRIPTS } from '../data/tutorial-script.js';

// One normal port command per scheduled tick. The mode policy owns progress.
export function createTutorialOpponentController({session,seatId,scheduler}) {
  const bound = session.port(seatId);
  if (!bound.ok) return bound;
  const policy = (query,commandId,queryAction) => {
    if (query.requiredInput) {
      if (!query.requiredInput.canAnswer) return {ok:false,error:{code:'AI_NOT_ACTIVE'}};
      if (query.requiredInput.presentationKey === 'security-rest') return {ok:true,value:{commandId,expectedRevision:query.status.revision,
        action:query.requiredInput.options.length ? {type:'answerChoice',choiceId:query.requiredInput.choiceId,optionIds:[query.requiredInput.options[0].optionId],allocation:[]}
          : {type:'declineChoice',choiceId:query.requiredInput.choiceId}}};
      return chooseSimpleAiIntent(query,commandId,queryAction);
    }
    const tutorial = session.tutorial();
    const expected = tutorial.ok ? TUTORIAL_OPPONENT_SCRIPTS[tutorial.value.opponentScript]?.[tutorial.value.opponentIndex] : null;
    if (!expected) return {ok:false,error:{code:'TUTORIAL_OPPONENT_IDLE'}};
    const cards = query.observation.seats.find(seat => seat.seatId === seatId)?.hand.cards ?? [];
    const entry = query.legalActions.find(item => (item.kind === 'fixed' ? item.action.type : item.actionType) === expected.type
      && (!expected.cardId || cards.some(card => !card.faceDown && card.definition.id === expected.cardId && card.cardRef === (item.action?.cardRef ?? item.base?.cardRef))));
    if (!entry) return {ok:false,error:{code:'TUTORIAL_ACTION_NOT_EXPECTED'}};
    if (entry.kind === 'fixed') return {ok:true,value:{commandId,expectedRevision:query.status.revision,action:entry.action}};
    const selections = [];
    for (let stage = 0; stage < 5; stage += 1) {
      const planned = queryAction({expectedRevision:query.status.revision,actionId:entry.actionId,selections});
      if (!planned.ok) return planned;
      if (planned.value.completion) return {ok:true,value:{commandId,expectedRevision:query.status.revision,action:planned.value.completion.action}};
      const request = planned.value.selectionRequests[0];
      const option = request?.options.find(option => !expected.zone || option.zone === expected.zone);
      if (!option) return {ok:false,error:{code:'TUTORIAL_ACTION_NOT_EXPECTED'}};
      selections.push({requestId:request.requestId,optionIds:[option.optionId],allocation:[]});
    }
    return {ok:false,error:{code:'TUTORIAL_ACTION_NOT_EXPECTED'}};
  };
  return createRuntimeClientController({port:bound.value,policy,scheduler});
}
