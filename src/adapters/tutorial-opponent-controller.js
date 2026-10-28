import { createRuntimeClientController } from './runtime-client-controller.js';
import { chooseSimpleAiIntent } from './simple-ai-policy.js';
import { TUTORIAL_OPPONENT_SCRIPTS } from '../data/tutorial-script.js';

const refOf = item => item.action?.cardRef ?? item.action?.attackerRef ?? item.base?.cardRef ?? item.base?.attackerRef;

// Cards of the scripted seat a script line may name: its hand for plays, its areas for attacks.
function ownCards(query, seatId) {
  const seat = query.observation.seats.find(item => item.seatId === seatId);
  return seat ? ['hand', 'front', 'back'].flatMap(zone => seat[zone]?.cards ?? []) : [];
}

// Script lines name a target the way the mode policy compares them: 'fortress' is the user,
// 'card' needs the target's public definition. No target named: the first offered option.
function scriptedTarget(expected, options, query) {
  if (!expected.targetType && !expected.targetCardId) return options[0];
  const definitionOf = ref => query.observation.seats.flatMap(seat => ['hand', 'front', 'back', 'registry', 'trash', 'ban']
    .flatMap(zone => seat[zone]?.cards ?? [])).find(card => card.cardRef === ref && !card.faceDown)?.definition.id;
  return options.find(option => (!expected.targetType || (expected.targetType === 'fortress' ? option.kind === 'user' : option.kind === expected.targetType))
    && (!expected.targetCardId || option.kind === 'card' && definitionOf(option.cardRef) === expected.targetCardId));
}

// One normal port command per scheduled tick. The mode policy owns progress.
export function createTutorialOpponentController({session,seatId,scheduler,scripts = TUTORIAL_OPPONENT_SCRIPTS}) {
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
    const expected = tutorial.ok ? scripts[tutorial.value.opponentScript]?.[tutorial.value.opponentIndex] : null;
    if (!expected) return {ok:false,error:{code:'TUTORIAL_OPPONENT_IDLE'}};
    const cards = ownCards(query, seatId);
    const entry = query.legalActions.find(item => (item.kind === 'fixed' ? item.action.type : item.actionType) === expected.type
      && (!expected.cardId || cards.some(card => !card.faceDown && card.definition.id === expected.cardId && card.cardRef === refOf(item))));
    if (!entry) return {ok:false,error:{code:'TUTORIAL_ACTION_NOT_EXPECTED'}};
    if (entry.kind === 'fixed') return {ok:true,value:{commandId,expectedRevision:query.status.revision,action:entry.action}};
    const selections = [];
    for (let stage = 0; stage < 5; stage += 1) {
      const planned = queryAction({expectedRevision:query.status.revision,actionId:entry.actionId,selections});
      if (!planned.ok) return planned;
      if (planned.value.completion) return {ok:true,value:{commandId,expectedRevision:query.status.revision,action:planned.value.completion.action}};
      const request = planned.value.selectionRequests[0];
      const option = expected.type === 'attack' ? scriptedTarget(expected, request?.options ?? [], query)
        : request?.options.find(option => !expected.zone || option.zone === expected.zone);
      if (!option) return {ok:false,error:{code:'TUTORIAL_ACTION_NOT_EXPECTED'}};
      selections.push({requestId:request.requestId,optionIds:[option.optionId],allocation:[]});
    }
    return {ok:false,error:{code:'TUTORIAL_ACTION_NOT_EXPECTED'}};
  };
  return createRuntimeClientController({port:bound.value,policy,scheduler});
}
