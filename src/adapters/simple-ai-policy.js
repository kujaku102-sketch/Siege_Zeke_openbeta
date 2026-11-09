const failure = code => ({ ok: false, error: { code } });
const nonempty = value => typeof value === 'string' && value.length > 0;

// 開始手順v2.4では常にキープ(keepOpeningHandが合法なら引き直さない)。legacyはkeepOpeningHandが無く、従来どおりopeningMulliganを選ぶ。
const PRIORITY = Object.freeze([
  'keepOpeningHand', 'openingMulligan', 'install', 'activateAbility', 'executeLayered', 'executeCard',
  'executeSpell','mountCard','setScript','executeRegistry','activateCardEffect',
  'activateScript', 'attack', 'redeploy', 'recoverRegistry', 'endTurn'
]);

// 同じカードの再実行と能力起動は、それぞれ1ターン1回まで。淫魔像のように移動でメモリが戻ると、
// 前後へ動かし続けたり同じ能力を起動し続けたりして手番が終わらなくなるのを防ぐ。
const REPEAT_LIMITED_ACTIONS = Object.freeze(['redeploy', 'activateCardEffect']);
const REPEAT_LIMIT_PER_TURN = 1;
const redeployLog = new Map();

function redeployTurnCounts(query) {
  const observation = query.observation ?? {};
  const key = `${query.status?.matchId}|${query.status?.viewerSeat}`;
  const turn = observation.turnNumber;
  const current = redeployLog.get(key);
  if (current?.turn === turn) return current.counts;
  const next = { turn, counts: new Map() };
  redeployLog.set(key, next);
  return next.counts;
}

// 回答が拒否されるとリビジョンが進まず同じ選択がそのまま届く。同じ回答を送り続けると手番が止まるので、
// 同じ選択がリビジョンも変わらず再び届いたら、候補を1つずらして別の回答を試す。
const answerLog = new Map();

function answerAttempt(query, input) {
  const key = `${query.status?.matchId}|${query.status?.viewerSeat}`;
  const revision = query.status?.revision;
  const current = answerLog.get(key);
  const attempt = current?.choiceId === input.choiceId && current.revision === revision ? current.attempt + 1 : 0;
  answerLog.set(key, { choiceId: input.choiceId, revision, attempt });
  return attempt;
}

// 結果の変わらない同じ処理を繰り返さない(文豪 2026-11-08「CPU操作の禁止事項でいい」。ルールではない: 人の操作は制限しない)。
// 窓への答えを出して受理され(リビジョンが進み)、次の判断のとき盤面(observation のうちリビジョンを除いたもの)が同じなら、その(盤面, 答え)を1回と数える。ターンが変わったら数え直す。
// 同じ盤面で結果の変わらなかった回数が REPEAT_BAN に達した答えは、次は出さない。別の答えがあるなら(選ぶ窓は次の選択肢、断っていた窓は選ぶ)それにし、無ければ普段の答えのまま(答えないと
// 試合が止まる)、数だけ残す。「断る」はいつもの答えなので DECLINE_BAN まで通す。メインの手は REPEAT_LIMITED_ACTIONS が受け持つ(この禁止の対象外)。
const REPEAT_BAN = 2;
const DECLINE_BAN = 5;
const loopLog = new Map();

function loopState(query) {
  const key = `${query.status?.matchId}|${query.status?.viewerSeat}`;
  const turn = query.observation?.turnNumber ?? null;
  const current = loopLog.get(key);
  if (current && current.turn === turn) return current;
  const next = { turn, counts: new Map(), last: null, unavoidable: current?.unavoidable ?? 0, replaced: current?.replaced ?? 0 };
  loopLog.set(key, next);
  return next;
}

const boardOf = query => JSON.stringify(query.observation ?? null, (field, value) => (field === 'revision' ? undefined : value));

// the answer last given was accepted and left the board as it was: it counts once
function settleLoop(query, state) {
  const last = state.last;
  state.last = null;
  if (last && Number.isSafeInteger(query.status?.revision) && query.status.revision > last.revision && boardOf(query) === last.board) {
    state.counts.set(last.key, (state.counts.get(last.key) ?? 0) + 1);
  }
}

const answerKey = action => `${action.type}|${(action.optionIds ?? []).join(',')}`;

export function simpleAiLoopStats(matchId, viewerSeat) {
  const state = loopLog.get(`${matchId}|${viewerSeat}`);
  return { unavoidable: state?.unavoidable ?? 0, replaced: state?.replaced ?? 0, counts: Object.fromEntries(state?.counts ?? []) };
}

function rotated(options, attempt) {
  if (!Array.isArray(options) || options.length < 2) return options;
  const shift = attempt % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}

function pickOptionIds(options, constraints) {
  if (!constraints || constraints.kind !== 'pick') return null;
  if (constraints.assignment === 'exclusive') {
    const groups = constraints.groups;
    const memberships = options.map(option => groups
      .map((group, index) => group.optionIds.includes(option.optionId) ? index : -1).filter(index => index >= 0));
    const search = (index, selected, counts) => {
      if (selected.length > constraints.maximum
        || selected.length + options.length - index < constraints.minimum) return null;
      if (selected.length >= constraints.minimum
        && groups.every((group, groupIndex) => counts[groupIndex] >= group.minimum
          && counts[groupIndex] <= group.maximum)) return [...selected];
      if (index === options.length) return selected.length >= constraints.minimum
        && groups.every((group, groupIndex) => counts[groupIndex] >= group.minimum
          && counts[groupIndex] <= group.maximum) ? [...selected] : null;
      const option = options[index];
      for (const groupIndex of memberships[index]) {
        if (counts[groupIndex] >= groups[groupIndex].maximum) continue;
        counts[groupIndex] += 1;
        selected.push(option.optionId);
        const assigned = search(index + 1, selected, counts);
        if (assigned) return assigned;
        selected.pop();
        counts[groupIndex] -= 1;
      }
      return search(index + 1, selected, counts);
    };
    return search(0, [], groups.map(() => 0));
  }
  if (constraints.groups.length === 0 && constraints.aggregate === null) {
    return options.length >= constraints.minimum ? options.slice(0, constraints.minimum).map(option => option.optionId) : null;
  }
  const groupSets = constraints.groups.map(group => new Set(group.optionIds));
  const values = new Map((constraints.aggregate?.optionValues ?? []).map(entry => [entry.optionId, entry.value]));
  const memo = new Set();
  const valid = selected => {
    if (selected.length < constraints.minimum || selected.length > constraints.maximum) return false;
    for (let index = 0; index < constraints.groups.length; index += 1) {
      const group = constraints.groups[index];
      const count = selected.filter(id => groupSets[index].has(id)).length;
      if (count < group.minimum || count > group.maximum) return false;
    }
    if (constraints.aggregate) {
      const total = selected.reduce((sum, id) => sum + Number(values.get(id) ?? 0), 0);
      if (constraints.aggregate.comparator === '=' && total !== constraints.aggregate.value) return false;
      if (constraints.aggregate.comparator === '<=' && total > constraints.aggregate.value) return false;
    }
    return true;
  };
  const search = (index, selected, counts, total) => {
    if (selected.length > constraints.maximum || selected.length + options.length - index < constraints.minimum) return null;
    if (constraints.aggregate && total > constraints.aggregate.value) return null;
    for (let groupIndex = 0; groupIndex < constraints.groups.length; groupIndex += 1) {
      const group = constraints.groups[groupIndex];
      if (counts[groupIndex] > group.maximum) return null;
      let remaining = 0;
      for (let optionIndex = index; optionIndex < options.length; optionIndex += 1) {
        if (groupSets[groupIndex].has(options[optionIndex].optionId)) remaining += 1;
      }
      if (counts[groupIndex] + remaining < group.minimum) return null;
    }
    const key = `${index}|${selected.length}|${total}|${counts.join(',')}`;
    if (memo.has(key)) return null;
    if (index === options.length) return valid(selected) ? [...selected] : null;
    const id = options[index].optionId;
    const nextCounts = counts.map((count, groupIndex) => count + (groupSets[groupIndex].has(id) ? 1 : 0));
    const included = search(index + 1, [...selected, id], nextCounts, total + Number(values.get(id) ?? 0));
    if (included) return included;
    const excluded = search(index + 1, selected, counts, total);
    if (excluded) return excluded;
    memo.add(key);
    return null;
  };
  return search(0, [], constraints.groups.map(() => 0), 0);
}

function allocationAnswer(input) {
  const constraints = input.constraints;
  if (!constraints || constraints.kind !== 'allocation') return null;
  if (constraints.total === 0 && constraints.allowNoOptions) return { optionIds: [], allocation: [] };
  const minimum = Math.max(1, constraints.minimumPerOption);
  const memo = new Set();
  const search = (index, remaining, allocation) => {
    if (remaining === 0) return allocation.length > 0 || constraints.allowNoOptions ? [...allocation] : null;
    if (index >= input.options.length) return null;
    const key = `${index}|${remaining}`;
    if (memo.has(key)) return null;
    const maximum = Math.min(remaining,
      constraints.maximumPerOption === null ? remaining : constraints.maximumPerOption);
    for (let amount = maximum; amount >= minimum; amount -= 1) {
      allocation.push({ optionId: input.options[index].optionId, amount });
      const result = search(index + 1, remaining - amount, allocation);
      if (result) return result;
      allocation.pop();
    }
    const skipped = search(index + 1, remaining, allocation);
    if (skipped) return skipped;
    memo.add(key);
    return null;
  };
  const allocation = search(0, constraints.total, []);
  return allocation ? { optionIds: allocation.map(entry => entry.optionId), allocation } : null;
}

// At turn end the CPU keeps one Security Ob asleep as the forced target: it rests the
// first ready one while none of its front Security Obs sleeps, then lets the turn end.
function securityRestAction(input, query) {
  const seat = query.observation?.seats?.find(item => item?.seatId === input.actorSeat);
  const guarding = (seat?.front?.cards ?? []).some(card => !card.faceDown && card.status?.sleep === true
    && (card.computed?.badges ?? []).some(badge => badge?.name === 'SECURITY'));
  return guarding || !input.options?.length ? { type: 'declineChoice', choiceId: input.choiceId }
    : { type: 'answerChoice', choiceId: input.choiceId, optionIds: [input.options[0].optionId], allocation: [] };
}

function requiredInputAction(input, query, { shift = 0, answer = false, again = false } = {}) {
  if (!input.canAnswer) return null;
  if (input.presentationKey === 'security-rest') return securityRestAction(input, query);
  if (input.constraints?.kind === 'random') return {
    type: 'answerChoice', choiceId: input.choiceId, optionIds: [], allocation: []
  };
  // The cost of an attack that was declared: it is paid when it can be (taking nothing fails the declaration), whatever else is optional.
  if (input.purpose === 'attack-declaration-cost' && input.options?.length) return {
    type: 'answerChoice', choiceId: input.choiceId, optionIds: [rotated(input.options, answerAttempt(query, input))[0].optionId], allocation: []
  };
  if (input.optional && !answer) return { type: 'declineChoice', choiceId: input.choiceId };
  // again: the second call for the same window (the answer that the ban replaces) does not count as a rejected answer
  const attempt = again ? (answerLog.get(`${query.status?.matchId}|${query.status?.viewerSeat}`)?.attempt ?? 0) : answerAttempt(query, input);
  const options = rotated(input.options, attempt + shift);
  if (input.constraints?.kind === 'allocation') {
    const answer = allocationAnswer({ ...input, options });
    return answer ? { type: 'answerChoice', choiceId: input.choiceId, ...answer } : null;
  }
  const optionIds = input.constraints?.kind === 'confirmation'
    ? options.slice(0, input.constraints.minimum).map(option => option.optionId)
    : pickOptionIds(options, input.constraints);
  if (!optionIds) return null;
  return {
    type: 'answerChoice', choiceId: input.choiceId,
    optionIds, allocation: []
  };
}

function templateAction(entry) {
  if (entry?.kind !== 'template' || entry.actionType !== 'executeLayered') return null;
  const materials = entry.parameters?.materials;
  const destinations = entry.parameters?.destination?.options;
  if (!materials || !Array.isArray(materials.options) || !Array.isArray(materials.groups)
    || !Array.isArray(destinations) || destinations.length === 0) return null;
  const optionIds = pickOptionIds(materials.options, {
    kind: 'pick', minimum: materials.minimum, maximum: materials.maximum,
    aggregate: null, groups: materials.groups, assignment: materials.assignment
  });
  if (!optionIds) return null;
  const byId = new Map(materials.options.map(option => [option.optionId, option.cardRef]));
  const destination = destinations[0];
  const materialRefs = optionIds.map(id => byId.get(id));
  if (materialRefs.some(ref => typeof ref !== 'string')) return null;
  return {
    type: 'executeLayered', cardRef: entry.base.cardRef, materialRefs,
    destination: { zone: destination.zone, slot: destination.slot }
  };
}

export function chooseSimpleAiIntent(query, commandId, queryAction = null) {
  if (!nonempty(commandId) || query === null || typeof query !== 'object') return failure('INVALID_AI_INPUT');
  const revision = query.status?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(query.legalActions)) return failure('INVALID_AI_INPUT');
  if (query.requiredInput !== null) {
    const input = query.requiredInput;
    const state = loopState(query);
    settleLoop(query, state);
    let action = requiredInputAction(input, query);
    if (!action) return failure(input.canAnswer ? 'AI_REQUIRED_INPUT_UNSUPPORTED' : 'AI_NOT_ACTIVE');
    const guarded = input.canAnswer && input.presentationKey !== 'security-rest' && input.constraints?.kind !== 'random' && input.purpose !== 'attack-declaration-cost';
    if (guarded) {
      const count = state.counts.get(answerKey(action)) ?? 0;
      if (count >= (action.type === 'declineChoice' ? DECLINE_BAN : REPEAT_BAN)) {
        // a window that was declined is answered; a window that was answered takes the next option that has not been tried as often
        const fresh = candidate => candidate && answerKey(candidate) !== answerKey(action) && (state.counts.get(answerKey(candidate)) ?? 0) < REPEAT_BAN;
        let other = null;
        if (action.type === 'declineChoice') other = requiredInputAction(input, query, { answer: true, again: true });
        else for (let shift = 1; shift < (input.options?.length ?? 0) && !fresh(other); shift += 1) other = requiredInputAction(input, query, { shift, again: true });
        if (fresh(other)) { action = other; state.replaced += 1; } else state.unavoidable += 1;
      }
      state.last = { revision, board: boardOf(query), key: answerKey(action) };
    }
    return { ok: true, value: { commandId, expectedRevision: revision, action } };
  }
  settleLoop(query, loopState(query));
  let selected = null;
  let plannedAction = null;
  const redeployCounts = redeployTurnCounts(query);
  const repeatKey = (type, cardRef) => `${type}:${cardRef}`;
  const overRedeployLimit = entry => {
    const type = entry?.kind === 'fixed' ? entry.action?.type : entry?.actionType;
    return REPEAT_LIMITED_ACTIONS.includes(type)
      && (redeployCounts.get(repeatKey(type, entry.base?.cardRef ?? entry.action?.cardRef)) ?? 0) >= REPEAT_LIMIT_PER_TURN;
  };
  for (const type of PRIORITY) {
    for (const entry of query.legalActions.filter(entry => (entry?.kind === 'fixed' ? entry.action?.type : entry?.actionType) === type && !overRedeployLimit(entry))) {
      if (entry.kind !== 'intent') { selected = entry; break; }
      if (typeof queryAction !== 'function') continue;
      const selections = [];
      for (let stage = 0; stage < 5; stage += 1) {
        const planned = queryAction({ expectedRevision: revision, actionId: entry.actionId, selections });
        if (!planned.ok) break;
        if (planned.value.completion) { plannedAction = planned.value.completion.action; selected = entry; break; }
        const request = planned.value.selectionRequests[0];
        if (!request) break;
        const ids = pickOptionIds(request.options, request.constraints);
        if (!ids) break;
        selections.push({ requestId: request.requestId, optionIds: ids, allocation: [] });
      }
      if (selected) break;
    }
    if (selected) break;
  }
  if (!selected) return failure('AI_NO_LEGAL_ACTION');
  const action = selected.kind === 'intent' ? plannedAction
    : selected.kind === 'template' ? templateAction(selected) : structuredClone(selected.action);
  if (!action) return failure('AI_ACTION_TEMPLATE_UNSUPPORTED');
  if (REPEAT_LIMITED_ACTIONS.includes(action.type)) {
    const key = repeatKey(action.type, action.cardRef);
    redeployCounts.set(key, (redeployCounts.get(key) ?? 0) + 1);
  }
  return { ok: true, value: {
    commandId, expectedRevision: revision, action
  } };
}

export function runSimpleAiPortStep(port, commandId) {
  if (!port || typeof port.query !== 'function' || typeof port.submit !== 'function') return failure('INVALID_AI_PORT');
  const query = port.query();
  if (!query.ok) return query;
  const intent = chooseSimpleAiIntent(query.value, commandId, input => port.queryAction(input));
  if (!intent.ok) return intent;
  return port.submit(intent.value);
}
