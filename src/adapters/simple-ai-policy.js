const failure = code => ({ ok: false, error: { code } });
const nonempty = value => typeof value === 'string' && value.length > 0;

const PRIORITY = Object.freeze([
  'openingMulligan', 'install', 'activateAbility', 'executeLayered', 'executeCard',
  'executeSpell','mountCard','setScript','executeRegistry','activateCardEffect',
  'activateScript', 'attack', 'redeploy', 'recoverRegistry', 'endTurn'
]);

// 同じカードの再実行は1ターン1回まで。淫魔像のように移動でメモリが戻ると、
// 前後へ動かし続けて手番が終わらなくなるのを防ぐ。
const REDEPLOY_LIMIT_PER_TURN = 1;
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

function requiredInputAction(input, query) {
  if (!input.canAnswer) return null;
  if (input.presentationKey === 'security-rest') return securityRestAction(input, query);
  if (input.constraints?.kind === 'random') return {
    type: 'answerChoice', choiceId: input.choiceId, optionIds: [], allocation: []
  };
  if (input.optional) return { type: 'declineChoice', choiceId: input.choiceId };
  const options = rotated(input.options, answerAttempt(query, input));
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
    const action = requiredInputAction(query.requiredInput, query);
    if (!action) return failure(query.requiredInput.canAnswer ? 'AI_REQUIRED_INPUT_UNSUPPORTED' : 'AI_NOT_ACTIVE');
    return { ok: true, value: { commandId, expectedRevision: revision, action } };
  }
  let selected = null;
  let plannedAction = null;
  const redeployCounts = redeployTurnCounts(query);
  const overRedeployLimit = entry => (entry?.actionType === 'redeploy' || entry?.action?.type === 'redeploy')
    && (redeployCounts.get(entry.base?.cardRef ?? entry.action?.cardRef) ?? 0) >= REDEPLOY_LIMIT_PER_TURN;
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
  if (action.type === 'redeploy') redeployCounts.set(action.cardRef, (redeployCounts.get(action.cardRef) ?? 0) + 1);
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
