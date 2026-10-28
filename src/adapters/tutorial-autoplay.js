import { tutorialSteps } from '../data/tutorial-script.js';
import { TUTORIAL_STEP_GUARDS } from './tutorial-mode-controller.js';
import { createTutorialOpponentController } from './tutorial-opponent-controller.js';

const failure = code => ({ ok: false, error: { code } });

// What the guide's step names (tutorial-mode-controller's `semantic.type`) back to the command types that can make it.
const COMMAND_TYPES = Object.freeze({
  play: ['executeCard', 'executeSpell', 'mountCard', 'setScript'], 'registry-execute': ['executeRegistry'], 'activate-effect': ['activateCardEffect'],
  layered: ['executeLayered'], relog: ['redeploy'], 'registry-recover': ['recoverRegistry'], 'end-turn': ['endTurn'],
  turbo: ['activateAbility'], 'script-activate': ['activateScript']
});
const commandTypes = type => COMMAND_TYPES[type] ?? [type];
const entryType = entry => entry.kind === 'fixed' ? entry.action.type : entry.actionType;
const entryRef = entry => entry.action?.cardRef ?? entry.action?.attackerRef ?? entry.base?.cardRef ?? entry.base?.attackerRef;
const MAX_ATTEMPTS = 400;

function cardsOf(query) {
  const cards = [], visit = card => { cards.push(card); if (!card.faceDown) card.mounted?.forEach(visit); };
  for (const seat of query.observation.seats) {
    seat.hand.cards?.forEach(visit);
    for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) seat[zone].cards.forEach(visit);
  }
  return cards;
}

// Plays the tutorial's own script for the learner, as ordinary seat-port commands the mode controller
// authorises one by one (so a skipped tutorial ends exactly where a played one does): the guide's
// lines are advanced, each expected move is made, the scripted opponent takes its turns. The session
// ends on the closing line with the opponent at STR 0 and the result locked for the player.
export function playTutorialToWin({ session }) {
  const scope = session.scope(), playerSeat = scope.seatIds[0], opponentSeat = scope.seatIds[1];
  const bound = session.port(playerSeat);
  if (!bound.ok) return bound;
  const port = bound.value;
  let serial = 0, attempts = 0;
  const flow = () => session.tutorial().value;
  const submit = action => {
    attempts += 1;
    const query = port.query().value;
    const result = port.submit({ commandId: `autoplay:${++serial}`, expectedRevision: query.status.revision, action });
    return result.ok && result.value.kind === 'accepted';
  };
  // An option the step's expectation favours comes first; every candidate is still tried in order,
  // because a refused command changes nothing.
  const ranked = (options, expect, rule, query) => {
    const cards = cardsOf(query), idOf = ref => cards.find(card => card.cardRef === ref && !card.faceDown)?.definition.id;
    const score = option => {
      let value = 0;
      if (expect?.zone && option.zone === expect.zone) value += 4;
      if (expect?.targetType === 'fortress' && option.kind === 'user') value += 4;
      if (expect?.targetCardId && (idOf(option.cardRef) === expect.targetCardId)) value += 4;
      if (expect?.hostCardId && (idOf(option.hostRef ?? option.cardRef) === expect.hostCardId)) value += 4;
      if (expect?.cardId && (option.preview?.definitionId === expect.cardId)) value += 4;
      if (rule?.choose && rule.choose({ kind: option.kind, label: option.label, cardId: idOf(option.cardRef) ?? option.preview?.definitionId ?? null })) value += 2;
      if (String(option.label ?? '').startsWith('レイヤー1枚を破棄')) value += 1;
      return value;
    };
    return options.map((option, index) => ({ option, index, value: score(option) })).sort((a, b) => b.value - a.value || a.index - b.index).map(item => item.option);
  };
  const picks = (options, minimum) => options.length ? [options.slice(0, Math.max(1, minimum ?? 1)), ...options.slice(1).map(option => [option])] : [];

  const answerInput = () => {
    const query = port.query().value, input = query.requiredInput, step = tutorialSteps(flow().flow.tutorialId)[flow().flow.index];
    if (!input?.canAnswer) return false;
    const rule = TUTORIAL_STEP_GUARDS[flow().flow.tutorialId]?.[flow().flow.index] ?? null;
    for (const optionSet of picks(ranked(input.options, step?.expect, rule, query), input.minimum)) {
      if (attempts > MAX_ATTEMPTS) return false;
      if (submit({ type: 'answerChoice', choiceId: input.choiceId, optionIds: optionSet.map(option => option.optionId), allocation: [] })) return true;
    }
    return input.optional && submit({ type: 'declineChoice', choiceId: input.choiceId });
  };

  const complete = (entry, expect, rule, selections, query) => {
    if (attempts > MAX_ATTEMPTS) return false;
    const planned = port.queryAction({ expectedRevision: query.status.revision, actionId: entry.actionId, selections });
    if (!planned.ok) return false;
    if (planned.value.completion) return submit(planned.value.completion.action);
    const request = planned.value.selectionRequests[0];
    for (const optionSet of picks(ranked(request.options, expect, rule, query), request.constraints?.minimum)) {
      const answer = { requestId: request.requestId, optionIds: optionSet.map(option => option.optionId), allocation: [] };
      if (complete(entry, expect, rule, [...selections, answer], query)) return true;
    }
    return false;
  };

  const expectedMove = () => {
    const state = flow(), step = tutorialSteps(state.flow.tutorialId)[state.flow.index], expect = step.expect;
    const rule = TUTORIAL_STEP_GUARDS[state.flow.tutorialId]?.[state.flow.index] ?? null;
    const query = port.query().value, cards = cardsOf(query), wanted = commandTypes(expect.type);
    const entries = query.legalActions.filter(entry => wanted.includes(entryType(entry))
      && (!expect.cardId || cards.some(card => !card.faceDown && card.cardRef === entryRef(entry) && card.definition.id === expect.cardId)));
    return entries.some(entry => entry.kind === 'fixed' ? submit(entry.action) : complete(entry, expect, rule, [], query));
  };

  const runOpponent = () => {
    const queue = [], controller = createTutorialOpponentController({ session, seatId: opponentSeat,
      scheduler: { schedule: task => { queue.push(task); return task; }, cancel: task => { const at = queue.indexOf(task); if (at >= 0) queue.splice(at, 1); } } });
    if (!controller.ok) return false;
    controller.value.start();
    for (let count = 0; count < 60 && queue.length; count += 1) queue.shift()();
    controller.value.dispose();
    return flow().opponentScript === null;
  };

  for (let guard = 0; guard < 400; guard += 1) {
    const state = flow();
    if (state.flow.complete) {
      const outcome = port.query().value.status.lockedOutcome;
      return outcome?.winnerSeat === playerSeat ? { ok: true, value: null } : failure('TUTORIAL_AUTOPLAY_NO_WIN');
    }
    const query = port.query().value;
    const expect = state.flow.introComplete ? tutorialSteps(state.flow.tutorialId)[state.flow.index].expect : { type: 'advance' };
    let moved;
    if (state.opponentScript) moved = runOpponent();
    // A guide line can be read over a choice the previous move left open (Rutile's access); it waits for its own step.
    else if (expect?.type === 'advance') moved = session.advanceTutorial().ok;
    else if (query.requiredInput?.canAnswer) moved = answerInput();
    else moved = query.requiredInput === null && expect ? expectedMove() : false;
    if (!moved) return failure('TUTORIAL_AUTOPLAY_STUCK');
  }
  return failure('TUTORIAL_AUTOPLAY_STUCK');
}
