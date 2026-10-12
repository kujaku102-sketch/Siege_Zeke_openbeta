import { readOwnData, readDenseData, readOrdinary } from './safe-read.js';

function exact(value, keys) {
  readOrdinary(value, 'INVALID_SELECTION');
  if (Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some(key => !keys.includes(key))) throw new Error('INVALID_SELECTION');
  return Object.fromEntries(keys.map(key => [key, readOwnData(value, key, 'INVALID_SELECTION')]));
}

export function readPlanningInput(input) {
  const value = exact(input, ['expectedRevision', 'actionId', 'selections']);
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || Object.is(value.expectedRevision, -0)
    || typeof value.actionId !== 'string' || !value.actionId) throw new Error('INVALID_PLANNING_INPUT');
  value.selections = readDenseData(value.selections, 'INVALID_SELECTION', new Set(), answer => {
    const row = exact(answer, ['requestId', 'optionIds', 'allocation']);
    if (typeof row.requestId !== 'string' || !row.requestId) throw new Error('INVALID_SELECTION');
    row.optionIds = readDenseData(row.optionIds, 'INVALID_SELECTION', new Set(), id => {
      if (typeof id !== 'string' || !id) throw new Error('INVALID_SELECTION');
      return id;
    });
    row.allocation = readDenseData(row.allocation, 'INVALID_SELECTION', new Set(), entry => {
      const result = exact(entry, ['optionId', 'amount']);
      if (typeof result.optionId !== 'string' || !Number.isSafeInteger(result.amount) || result.amount <= 0) throw new Error('INVALID_SELECTION');
      return result;
    });
    return row;
  });
  return value;
}

export function selectionRequest(requestId, presentationKey, options, constraints) {
  return { requestId, presentationKey, options, constraints };
}

export function requiredSelectionRequest(input) {
  return selectionRequest(input.choiceId, input.presentationKey, input.options, input.constraints);
}

export function validSelectionAnswer(request, answer) {
  if (!answer || answer.requestId !== request.requestId || !Array.isArray(answer.optionIds)
    || !Array.isArray(answer.allocation) || new Set(answer.optionIds).size !== answer.optionIds.length) return false;
  const allowed = new Set(request.options.map(option => option.optionId));
  if (answer.optionIds.some(id => !allowed.has(id))) return false;
  const c = request.constraints;
  if (c.kind === 'random') return answer.optionIds.length === 0 && answer.allocation.length === 0;
  if (c.kind === 'allocation') {
    if (answer.allocation.length !== answer.optionIds.length || new Set(answer.allocation.map(row => row.optionId)).size !== answer.allocation.length) return false;
    if (answer.allocation.some(row => !answer.optionIds.includes(row.optionId) || !Number.isSafeInteger(row.amount)
      || row.amount < Math.max(1, c.minimumPerOption) || c.maximumPerOption !== null && row.amount > c.maximumPerOption)) return false;
    return (answer.optionIds.length > 0 || c.allowNoOptions) && answer.allocation.reduce((sum, row) => sum + row.amount, 0) === c.total;
  }
  if (answer.allocation.length || !['pick', 'confirmation'].includes(c.kind)
    || answer.optionIds.length < c.minimum || answer.optionIds.length > c.maximum) return false;
  if (c.aggregate) {
    const values = new Map(c.aggregate.optionValues.map(row => [row.optionId, row.value]));
    const total = answer.optionIds.reduce((sum, id) => sum + (values.get(id) ?? 0), 0);
    if (c.aggregate.comparator === '=' ? total !== c.aggregate.value : total > c.aggregate.value) return false;
  }
  if (c.assignment === 'exclusive') return exclusiveAssignment(answer.optionIds, c.groups);
  return (c.groups ?? []).every(group => {
    const count = answer.optionIds.filter(id => group.optionIds.includes(id)).length;
    return count >= group.minimum && count <= group.maximum;
  });
}

// Bipartite matching: mandatory group slots first, then cover every selected option.
function exclusiveAssignment(ids, groups) {
  const slots = groups.flatMap(group => Array.from({ length: Math.min(group.maximum, ids.length) }, (_, index) => ({
    mandatory: index < group.minimum, ids: new Set(group.optionIds)
  })));
  if (groups.some(group => group.minimum > ids.length)) return false;
  const slotToId = new Map();
  const idToSlot = new Map();
  const fillSlot = (slot, seen) => {
    for (const id of ids) {
      if (!slots[slot].ids.has(id) || seen.has(id)) continue;
      seen.add(id);
      const previous = idToSlot.get(id);
      if (previous === undefined || fillSlot(previous, seen)) {
        slotToId.set(slot, id); idToSlot.set(id, slot); return true;
      }
    }
    return false;
  };
  for (const [index, slot] of slots.entries()) if (slot.mandatory && !fillSlot(index, new Set())) return false;
  const fillId = (id, seen) => {
    for (let slot = 0; slot < slots.length; slot += 1) {
      if (!slots[slot].ids.has(id) || seen.has(slot)) continue;
      seen.add(slot);
      const previous = slotToId.get(slot);
      if (previous === undefined || fillId(previous, seen)) {
        slotToId.set(slot, id); idToSlot.set(id, slot); return true;
      }
    }
    return false;
  };
  return ids.every(id => idToSlot.has(id) || fillId(id, new Set()));
}
