import { groupId, optionId } from './shared.js';

function pickConstraints(request, candidates) {
  const optionFor = new Map(candidates.map((value, index) => [value, optionId(index)]));
  const comparator = request.exactBudget !== null && request.exactBudget !== undefined ? '='
    : request.budget !== null && request.budget !== undefined ? '<=' : null;
  const aggregate = comparator === null ? null : {
    comparator,
    value: Number(comparator === '=' ? request.exactBudget : request.budget),
    optionValues: candidates.map((value, index) => ({
      optionId: optionId(index), value: Number(request.candidateValues?.[value] ?? 0)
    }))
  };
  const groups = (request.groups ?? []).map((group, index) => ({
    groupId: groupId(index),
    minimum: Number(group.minimum ?? 0),
    maximum: Math.min(candidates.length, Number.isFinite(group.maximum ?? group.count)
      ? Number(group.maximum ?? group.count) : candidates.length),
    optionIds: candidates.filter(value => group.candidates?.includes(value)).map(value => optionFor.get(value))
  }));
  return {
    kind: 'pick', minimum: Number(request.minimum ?? 0),
    maximum: Math.min(candidates.length, Number.isFinite(request.maximum ?? request.count)
      ? Number(request.maximum ?? request.count) : candidates.length), aggregate, groups
  };
}

export function selectionConstraints(request, candidates) {
  if (request.mode === 'random') return {
    kind: 'random', answer: 'commit-empty', count: Number(request.count ?? 0)
  };
  if (request.spec?.kind === 'allocation') return {
    kind: 'allocation', total: Number(request.spec.total ?? 0),
    minimumPerOption: Number(request.spec.minimumPerTarget ?? 0),
    maximumPerOption: request.spec.maximumPerTarget === null ? null : Number(request.spec.maximumPerTarget),
    allowNoOptions: Boolean(request.spec.allowNoTargets),
    optionIds: candidates.map((_, index) => optionId(index))
  };
  return pickConstraints(request, candidates);
}

export function selectionPresentationKey(request) {
  if (request.spec?.kind === 'allocation') return 'allocation';
  if (request.mode === 'random') return 'random';
  if (request.mode === 'scope') return request.spec?.kind === 'choice' ? 'choice' : 'value';
  if ((request.groups ?? []).length > 0) return 'grouped-card';
  return 'card';
}
