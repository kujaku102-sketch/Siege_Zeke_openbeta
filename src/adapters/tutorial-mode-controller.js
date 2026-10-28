import { createTutorialFlow, currentTutorialPresentation, currentTutorialStep,
  advanceTutorialIntroduction, tutorialSteps, matches, TUTORIAL_OPPONENT_SCRIPTS } from '../data/tutorial-script.js';

const failure = code => ({ ok: false, error: { code } });

// What a step's own `expect` (tutorial-script.js) leaves open but the script relies on: a different
// choice there can leave the tutorial unwinnable. Keyed by tutorial and step index. `action` adds
// fields the step's action must also match; `choose` is the test every option picked while the step
// resolves must pass (picking none, or declining, is refused too); `reason` is shown in the guide.
const LAYER_COST = option => option.kind !== 'value' || String(option.label ?? '').startsWith('レイヤー1枚を破棄');
export const TUTORIAL_STEP_GUARDS = Object.freeze({
  // Red (44 steps; index 37): the Junk Parts must be mounted under Atto. Alone in a slot, or under the soldier,
  // Atto stays at ATK 3 and cannot break the Guardman (STR 4), so the soldier never reaches the user.
  basics: Object.freeze({
    37: Object.freeze({ action: { hostCardId: 'STD-091' }, reason: 'ジャンクパーツは『アツト』の下に実行して、マウントして。' })
  }),
  // Blue (28 steps). 6: Rutile's access must take the Offense Protocol (the Assault Program is in the list too).
  // 12: the Offense Protocol goes on Frau. 16 / 26: Frau, who has Hacking, must hit the user, not Merc.
  blue: Object.freeze({
    6: Object.freeze({ choose: option => option.cardId === 'STD-111', reason: 'アクセスは『オフェンスプロトコル』を選んで。' }),
    12: Object.freeze({ action: { targetCardId: 'STD-109' }, reason: '『オフェンスプロトコル』は『フラウ』に使って。' }),
    16: Object.freeze({ action: { targetType: 'fortress' }, reason: '攻撃は相手ユーザーを選んで。' }),
    26: Object.freeze({ action: { targetType: 'fortress' }, reason: '攻撃は相手ユーザーを選んで。' })
  }),
  vengeance: Object.freeze({
    3: Object.freeze({ choose: LAYER_COST, reason: '移動コストは『レイヤー1枚を破棄』で払って。' }),
    6: Object.freeze({ action: { targetCardId: 'STD-194' }, reason: '効果の対象は『アクロィア』を選んで。' }),
    8: Object.freeze({ choose: LAYER_COST, reason: '移動コストは『レイヤー1枚を破棄』で払って。' })
  })
});
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
  // Every tutorial ends by the player's win: once the result is locked for the player and nothing is
  // left to answer, the guide moves to the closing line (the last step) and the tutorial is complete.
  const finishOnWin = () => {
    flow.index = tutorialSteps(tutorialId).length - 1;
    flow.complete = true;
    flow.error = '';
    acceptedAction = null;
    opponentScript = null;
  };
  const guard = () => TUTORIAL_STEP_GUARDS[tutorialId]?.[flow.index] ?? null;
  const refuse = (code, reason) => { flow.error = reason ?? ''; return failure(code); };
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
      const playerSeat = query.observation.seats[0].seatId;
      const cards = visibleCards(query);
      if (['answerChoice', 'declineChoice'].includes(action.type)) {
        const guided = query.status.viewerSeat === playerSeat && flow.introComplete && !flow.complete;
        const rule = guided ? guard() : null, expect = guided ? currentTutorialStep(flow).expect : null;
        // While the guide only speaks, a choice a step left open (leavesChoice) waits for its own step.
        if (expect?.type === 'advance') return refuse('TUTORIAL_CHOICE_NOT_EXPECTED');
        const answered = expect?.type === 'answerChoice';
        if (!rule?.choose && !answered) return { ok: true, value: null };
        if (action.type === 'declineChoice') return refuse('TUTORIAL_CHOICE_NOT_EXPECTED', rule?.reason);
        const options = (action.optionIds ?? []).map(id => query.requiredInput?.options?.find(option => option.optionId === id));
        const picked = options.map(option => option && { kind: option.kind, label: option.label,
          cardId: cards.find(card => card.cardRef === option.cardRef && !card.faceDown)?.definition.id ?? option.preview?.definitionId ?? null });
        return picked.length && picked.every(option => option && (!rule?.choose || rule.choose(option))
          && (!answered || matches(expect, { type: 'answerChoice', cardId: option.cardId })))
          ? { ok: true, value: null } : refuse('TUTORIAL_CHOICE_NOT_EXPECTED', rule?.reason);
      }
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
        targetCardId: target?.faceDown ? null : target?.definition.id,
        hostCardId: host?.faceDown ? null : host?.definition.id ?? null
      };
      if (query.status.viewerSeat !== playerSeat) {
        const original = TUTORIAL_OPPONENT_SCRIPTS[opponentScript]?.[opponentIndex];
        const expected = original ? {...original,type:({executeCard:'play',endTurn:'end-turn'})[original.type] ?? original.type} : null;
        return expected && !opponentActionPending && matches(expected, semantic)
          ? { ok: true, value: null } : failure('TUTORIAL_ACTION_NOT_EXPECTED');
      }
      if (!flow.introComplete || flow.complete || acceptedAction || opponentScript) return failure('TUTORIAL_ACTION_NOT_EXPECTED');
      const rule = guard(), expect = currentTutorialStep(flow).expect;
      // The step's own card played elsewhere (the Junk Parts alone in the back) is told the same reason.
      if (!matches(expect, semantic)) return rule?.action && semantic.cardId === expect.cardId && semantic.type === expect.type
        ? refuse('TUTORIAL_ACTION_NOT_EXPECTED', rule.reason) : failure('TUTORIAL_ACTION_NOT_EXPECTED');
      return !rule?.action || matches(rule.action, semantic) ? { ok: true, value: null } : refuse('TUTORIAL_ACTION_NOT_EXPECTED', rule.reason);
    },
    accepted(query, action) {
      if (disposed) return;
      const playerSeat = query.observation.seats[0].seatId;
      if (query.status.viewerSeat === playerSeat) flow.error = '';
      if (query.status.lockedOutcome?.winnerSeat === playerSeat && query.requiredInput === null && flow.introComplete && !flow.complete) return finishOnWin();
      if (query.status.viewerSeat !== playerSeat && !['answerChoice', 'declineChoice'].includes(action.type)) opponentActionPending = true;
      const step = flow.introComplete && !flow.complete ? currentTutorialStep(flow) : null;
      // A choice is the step's own action only when the step expects the answer; a step that
      // leavesChoice is done with the move itself and lets the guide talk over the open choice.
      if (query.status.viewerSeat === playerSeat && (!['answerChoice', 'declineChoice'].includes(action.type) || step?.expect?.type === 'answerChoice')) {
        acceptedAction = structuredClone(action);
      }
      if (acceptedAction && (query.requiredInput === null || step?.leavesChoice) && query.status.progress !== 'resultLocked') stepFinished();
      if (opponentActionPending && query.requiredInput === null) {
        opponentIndex += 1;
        opponentActionPending = false;
      }
      if (opponentScript && query.status.activeSeat === playerSeat && query.requiredInput === null) opponentScript = null;
    },
    dispose() { disposed = true; acceptedAction = null; opponentScript = null; }
  });
}
