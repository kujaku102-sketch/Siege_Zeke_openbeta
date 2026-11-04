import { createTutorialFlow, currentTutorialPresentation, currentTutorialStep,
  advanceTutorialIntroduction, tutorialSteps, matches, TUTORIAL_OPPONENT_SCRIPTS } from '../data/tutorial-script.js';

const failure = code => ({ ok: false, error: { code } });

// What a step's own `expect` (tutorial-script.js) leaves open but the script relies on: a different
// choice there can leave the tutorial unwinnable. Keyed by tutorial and step index. `action` adds
// fields the step's action must also match; `choose` is the test every option picked while the step
// resolves must pass (picking none, or declining, is refused too); `reason` is shown in the guide.
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
  // Yellow (27 steps). 3: the OC is paid (the choice's label). 5 / 16: the [セキュリティ] rest asked as a turn ends takes Shield Knight / the Herald
  // (the step's answerChoice). 11: Shield Bash goes on the Rider. 13 / 25: the attacks hit the user. 23: the Triumph takes ①.
  // The step's expect refuses another pick and declining; the reasons are for the guide.
  yellow: Object.freeze({
    3: Object.freeze({ reason: '『OC』の追加メモリ4を払って。' }),
    5: Object.freeze({ reason: 'スリープさせるのは『大盾の騎士』。大盾の騎士を選んで。' }),
    11: Object.freeze({ action: { targetCardId: 'STD-025' }, reason: '『シールドバッシュ』は相手の『ライダー』に使って。' }),
    13: Object.freeze({ action: { targetType: 'fortress' }, reason: '攻撃は相手ユーザーを選んで。' }),
    16: Object.freeze({ reason: 'スリープさせるのは『伝令』。伝令を選んで。' }),
    23: Object.freeze({ reason: '『騎士団の凱歌』は①の「自分Obすべてを+2/+2」を選んで。' }),
    25: Object.freeze({ action: { targetType: 'fortress' }, reason: '攻撃は相手ユーザーを選んで。' })
  }),
  // Black (29 steps). 6 / 11 / 13 / 14 / 22: the picks of the Conquistador's destroy, Remegeton's access, Solomon's destroy and placement, the decode
  // (the step's answerChoice; the decoded Ob is placed in the front). 25: the Pact destroys exactly the Zombie Maker and the Resentful Doll, takes ② each time,
  // and the first ② goes to the damaged Merc (the second then has only the other): both Mercs are destroyed. 27: the attack hits the user.
  black: Object.freeze({
    6: Object.freeze({ reason: '破壊するのは『怨念人形』を選んで。' }),
    11: Object.freeze({ reason: 'アクセスは『魔術王ソロモン』を選んで。' }),
    13: Object.freeze({ reason: '破壊するのは『レメゲトン』を選んで。' }),
    14: Object.freeze({ reason: '出すのは『豹頭男爵フラウロス』を選んで。' }),
    22: Object.freeze({ choose: option => option.kind === 'destination' ? option.zone === 'front' : option.cardId === 'STD-150', reason: 'ゴミ箱の『怨念人形』を選んで、フロントに置いて。' }),
    25: Object.freeze({
      pickCount: 2,
      choose: (option, context) => {
        if (/^[①②]/.test(option.label ?? '')) return option.label.startsWith('②');
        if (option.cardId === 'STD-043') return option.damage === Math.max(...(context?.options ?? []).filter(item => item.cardId === 'STD-043').map(item => item.damage));
        return ['STD-152', 'STD-150'].includes(option.cardId);
      },
      reason: '『邪神との取引』は『ゾンビメイカー』と『怨念人形』の2体を壊して、②を選ぶ。1回目の②は、ダメージを受けている『メルク』に。'
    }),
    27: Object.freeze({ action: { targetType: 'fortress' }, reason: '攻撃は相手ユーザーを選んで。' })
  }),
  // Purple (26 steps). 6: Gigantes is layered on both Dolls (the layered execution takes 1 or 2 materials; with one Doll left in the front the
  // script's field is not the one it describes). 14: the optional [セキュリティ] rest asked as the turn ends (step 13) takes Gigantes (the step's
  // answerChoice): awake, the Rider would not be held to attacking it. The step's expect refuses another pick and declining; this gives the reason.
  vengeance: Object.freeze({
    6: Object.freeze({ action: { materialCount: 2 }, reason: '素材は『ドールズ』2体を選んで。' }),
    14: Object.freeze({ choose: option => option.cardId === 'STD-205', reason: 'スリープさせるのは『ギガンテス』。ギガンテスを選んで。' })
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

// The guide's own progress, as a snapshot restores it into a new controller. Five items: the flow, the
// opponent's script and its index, whether the current step's action is already accepted, and whether
// an opponent action awaits its answer. The accepted action itself is never kept (only whether there is
// one is read), so no card reference is stored. Returns a copy, or null when it does not fit the tutorial.
const isIndex = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max && !Object.is(value, -0);
const isPlain = (value, names) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
function introLength(tutorialId) {
  const flow = createTutorialFlow(tutorialId);
  let length = 0;
  while (!flow.introComplete) { advanceTutorialIntroduction(flow); length += 1; }
  return length;
}
export function tutorialStateData(tutorialId, state) {
  const steps = tutorialSteps(tutorialId);
  if (!steps?.length || !isPlain(state, ['flow', 'opponentScript', 'opponentIndex', 'stepActionAccepted', 'opponentActionPending'])) return null;
  const { flow } = state;
  if (!isPlain(flow, Object.keys(createTutorialFlow(tutorialId))) || flow.tutorialId !== tutorialId) return null;
  const intro = introLength(tutorialId);
  if (typeof flow.introComplete !== 'boolean' || typeof flow.complete !== 'boolean' || flow.error !== '' || flow.pendingAction !== null) return null;
  if (!isIndex(flow.introIndex, Math.max(intro - 1, 0)) || !isIndex(flow.index, steps.length)) return null;
  if (flow.introComplete ? flow.introIndex !== Math.max(intro - 1, 0) : intro === 0) return null;
  if (flow.complete !== (flow.index >= steps.length - 1) || flow.complete && !flow.introComplete) return null;
  const script = state.opponentScript === null ? null : TUTORIAL_OPPONENT_SCRIPTS[state.opponentScript] ?? null;
  if (state.opponentScript !== null && (typeof state.opponentScript !== 'string' || !Object.hasOwn(TUTORIAL_OPPONENT_SCRIPTS, state.opponentScript))) return null;
  // A finished script is cleared but its index stays where the script ended.
  const longest = Math.max(...Object.values(TUTORIAL_OPPONENT_SCRIPTS).map(rows => rows.length));
  if (!isIndex(state.opponentIndex, script?.length ?? longest)) return null;
  if (typeof state.stepActionAccepted !== 'boolean' || typeof state.opponentActionPending !== 'boolean') return null;
  return structuredClone(state);
}

export function createTutorialModeController(tutorialId = 'basics', initial = null) {
  const flow = createTutorialFlow(tutorialId);
  const restored = initial === null ? null : tutorialStateData(tutorialId, initial);
  if (initial !== null && !restored) throw new TypeError('TUTORIAL_STATE_INVALID');
  if (restored) Object.assign(flow, restored.flow);
  let stepActionAccepted = restored?.stepActionAccepted ?? false;
  let opponentScript = restored?.opponentScript ?? null;
  let opponentIndex = restored?.opponentIndex ?? 0;
  let opponentActionPending = restored?.opponentActionPending ?? false;
  let disposed = false;
  const stepFinished = () => {
    const step = currentTutorialStep(flow);
    // A step without an opponent turn leaves a running script alone; clearing it would strand the match in the opponent's turn.
    if (step.after) { opponentScript = step.after; opponentIndex = 0; }
    flow.index += 1;
    flow.complete = flow.index >= tutorialSteps(tutorialId).length - 1;
    stepActionAccepted = false;
  };
  // Every tutorial ends by the player's win: once the result is locked for the player and nothing is
  // left to answer, the guide moves to the closing line (the last step) and the tutorial is complete.
  const finishOnWin = () => {
    flow.index = tutorialSteps(tutorialId).length - 1;
    flow.complete = true;
    flow.error = '';
    stepActionAccepted = false;
    opponentScript = null;
  };
  const guard = () => TUTORIAL_STEP_GUARDS[tutorialId]?.[flow.index] ?? null;
  const refuse = (code, reason) => { flow.error = reason ?? ''; return failure(code); };
  return Object.freeze({
    presentation() { return structuredClone({ flow, presentation: currentTutorialPresentation(flow), opponentScript, opponentIndex }); },
    state() { return structuredClone({ flow: { ...flow, error: '' }, opponentScript, opponentIndex, stepActionAccepted, opponentActionPending }); },
    advance() {
      if (disposed) return failure('TUTORIAL_DISPOSED');
      if (!flow.introComplete) advanceTutorialIntroduction(flow);
      // The guide waits while the opponent's script plays: it ends with the player's turn started (memory refilled).
      else if (opponentScript) return failure('TUTORIAL_OPPONENT_TURN');
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
        // What an option stands for: its card, label, placement zone, and the damage the card carries (two cards of one name are told apart by it).
        const describe = option => {
          const card = cards.find(item => item.cardRef === option.cardRef && !item.faceDown);
          return { kind: option.kind, label: option.label, zone: option.zone, cardRef: option.cardRef ?? null,
            cardId: card?.definition.id ?? option.preview?.definitionId ?? null, damage: Number(card?.status?.damage ?? 0) };
        };
        const picked = (action.optionIds ?? []).map(id => query.requiredInput?.options?.find(option => option.optionId === id)).map(option => option && describe(option));
        // `choose(option, context)`: context.picked is the whole answer, context.options everything the choice offers. `pickCount` is how many options the
        // answer must hold where the choice allows that many (the Pact's destroy takes two; its other choices take one).
        const context = { picked, options: (query.requiredInput?.options ?? []).map(describe) };
        const countOk = !rule?.pickCount || !(Number(query.requiredInput?.maximum) >= rule.pickCount) || picked.length === rule.pickCount;
        // A placement (a destination option: front, back, or a layer) is judged by the guard alone when the step has one; every other option must be what the step's expect names.
        return picked.length && countOk && picked.every(option => option && (!rule?.choose || rule.choose(option, context))
          && (!answered || (option.zone !== undefined || option.kind === 'destination') && Boolean(rule?.choose)
            || matches(expect, { type: 'answerChoice', cardId: option.cardId, label: option.label })))
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
        hostCardId: host?.faceDown ? null : host?.definition.id ?? null,
        materialCount: Array.isArray(action.materialRefs) ? action.materialRefs.length : undefined
      };
      if (query.status.viewerSeat !== playerSeat) {
        const original = TUTORIAL_OPPONENT_SCRIPTS[opponentScript]?.[opponentIndex];
        const expected = original ? {...original,type:({executeCard:'play',endTurn:'end-turn'})[original.type] ?? original.type} : null;
        return expected && !opponentActionPending && matches(expected, semantic)
          ? { ok: true, value: null } : failure('TUTORIAL_ACTION_NOT_EXPECTED');
      }
      if (!flow.introComplete || flow.complete || stepActionAccepted || opponentScript) return failure('TUTORIAL_ACTION_NOT_EXPECTED');
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
        stepActionAccepted = true;
      }
      if (stepActionAccepted && (query.requiredInput === null || step?.leavesChoice) && query.status.progress !== 'resultLocked') stepFinished();
      if (opponentActionPending && query.requiredInput === null) {
        opponentIndex += 1;
        opponentActionPending = false;
      }
      if (opponentScript && query.status.activeSeat === playerSeat && query.requiredInput === null) opponentScript = null;
    },
    dispose() { disposed = true; stepActionAccepted = false; opponentScript = null; }
  });
}
