import { requiredSelectionRequest, validSelectionAnswer } from '../selection-contract.js';
import { current } from './pending-input.js';
import { failure } from './shared.js';

export function prepareRequiredInputAction(authority, actorSeat, action) {
  const input = current(authority);
  if (!input || input.actorSeat !== actorSeat || action.choiceId !== input.dto.choiceId) return failure('ACTION_NOT_ALLOWED');
  if (action.type === 'declineChoice') {
    if (!input.dto.optional) return failure('ACTION_NOT_ALLOWED');
    return { ok: true, value: { engineFunction: 'declineRequiredInput', playerId: input.playerId, revision: authority.revision } };
  }
  if (!validSelectionAnswer(requiredSelectionRequest(input.dto), {
    requestId: action.choiceId, optionIds: action.optionIds, allocation: action.allocation
  })) return failure('ACTION_NOT_ALLOWED');
  const indexes = action.optionIds.map(id => input.dto.options.findIndex(option => option.optionId === id));
  if (indexes.some(index => index < 0) || new Set(indexes).size !== indexes.length) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.optional && indexes.length === 0 && action.allocation.length === 0 && input.source !== 'selection') {
    return {ok:true,value:{engineFunction:'declineRequiredInput',playerId:input.playerId,revision:authority.revision}};
  }
  const allocation = action.allocation.map(entry => ({
    optionIndex: input.dto.options.findIndex(option => option.optionId === entry.optionId), amount: entry.amount
  }));
  if (allocation.some(entry => entry.optionIndex < 0)) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.kind !== 'allocation' && allocation.length) return failure('ACTION_NOT_ALLOWED');
  if (input.dto.kind === 'allocation') {
    if (allocation.some(entry => !Number.isSafeInteger(entry.amount) || entry.amount <= 0)
      || new Set(allocation.map(entry => entry.optionIndex)).size !== allocation.length) return failure('ACTION_NOT_ALLOWED');
    const positive = [...allocation.map(entry => entry.optionIndex)].sort((a, b) => a - b);
    const selected = [...indexes].sort((a, b) => a - b);
    if (positive.length !== selected.length || positive.some((value, index) => value !== selected[index])) {
      return failure('ACTION_NOT_ALLOWED');
    }
  }
  if (input.source === 'selection' && authority.engineState.pending.request.mode === 'random' && action.optionIds.length) {
    return failure('ACTION_NOT_ALLOWED');
  }
  return { ok: true, value: {
    engineFunction: 'answerRequiredInput', playerId: input.playerId, revision: authority.revision,
    optionIndexes: indexes, allocation
  } };
}
