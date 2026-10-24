const SELECTION_MODES = Object.freeze(["single", "exact", "up_to", "scope", "random"]);
const SELECTION_SPEC_KINDS = Object.freeze(["selection", "grouped_selection", "random_selection", "choice", "allocation"]);

export function createSelectionSpec({ candidates = [], minimum = 1, maximum = 1, aggregateConstraint = null, relations = [], ...rest } = {}) {
  return Object.freeze({ kind: "selection", candidates: [...new Set(candidates)], minimum, maximum, aggregateConstraint, relations, ...rest });
}

export function createGroupedSelectionSpec({ groups = [], minimum = null, maximum = null, ...rest } = {}) {
  const normalizedGroups = groups.map((group) => Object.freeze({ ...group, candidates: [...new Set(group.candidates ?? [])], minimum: group.minimum ?? 0, maximum: group.maximum ?? group.count ?? 1 }));
  return Object.freeze({ kind: "grouped_selection", groups: normalizedGroups, minimum, maximum, ...rest });
}

export function createRandomSelectionSpec({ pools = [], count = 1, perPool = false, withoutReplacement = true, ...rest } = {}) {
  return Object.freeze({ kind: "random_selection", pools: pools.map((pool) => Object.freeze({ ...pool, candidates: [...new Set(pool.candidates ?? [])], count: pool.count ?? count })), count, perPool, withoutReplacement, ...rest });
}

export function createChoiceSpec({ options = [], minimum = 1, maximum = 1, repeat = 1, ...rest } = {}) {
  return Object.freeze({ kind: "choice", options: options.map((option) => Object.freeze(typeof option === "string" ? { id: option, label: option } : { ...option })), minimum, maximum, repeat, ...rest });
}

export function createAllocationSpec({ targets = [], total = 0, minimumPerTarget = 0, maximumPerTarget = null, allowNoTargets = true, ...rest } = {}) {
  return Object.freeze({ kind: "allocation", targets: [...new Set(targets)], total: Math.max(0, Number(total) || 0), minimumPerTarget, maximumPerTarget, allowNoTargets, ...rest });
}

export function selectionRequestFromSpec(spec, options = {}) {
  if (!spec || !SELECTION_SPEC_KINDS.includes(spec.kind)) throw new Error(`Unknown selection spec: ${spec?.kind}`);
  if (spec.kind === "choice") return createSelectionRequest({ mode: "scope", scopeField: "choice", scopeOptions: spec.options.map((option) => option.id), minimum: spec.minimum, maximum: spec.maximum, spec, ...options });
  if (spec.kind === "random_selection") {
    const candidates = spec.pools.flatMap((pool) => pool.candidates);
    return createSelectionRequest({ mode: "random", candidates, count: spec.count, minimum: 0, maximum: candidates.length, randomPools: spec.pools, spec, ...options });
  }
  if (spec.kind === "grouped_selection") {
    const candidates = spec.groups.flatMap((group) => group.candidates);
    const minimum = spec.minimum ?? spec.groups.reduce((sum, group) => sum + group.minimum, 0);
    const maximum = spec.maximum ?? spec.groups.reduce((sum, group) => sum + group.maximum, 0);
    return createSelectionRequest({ mode: minimum === maximum ? "exact" : "up_to", candidates, count: maximum, minimum, maximum, groups: spec.groups, spec, ...options });
  }
  if (spec.kind === "allocation") return createSelectionRequest({ mode: "up_to", candidates: spec.targets, count: spec.targets.length, minimum: spec.allowNoTargets ? 0 : 1, maximum: spec.targets.length, allocation: Object.fromEntries(spec.targets.map((target) => [target, 0])), spec, ...options });
  const aggregate = spec.aggregateConstraint;
  return createSelectionRequest({ mode: spec.minimum === 1 && spec.maximum === 1 ? "single" : spec.minimum === spec.maximum ? "exact" : "up_to", candidates: spec.candidates, count: spec.maximum, minimum: spec.minimum, maximum: spec.maximum, budget: aggregate?.comparator === "<=" ? aggregate.value : null, exactBudget: aggregate?.comparator === "=" ? aggregate.value : null, candidateValues: aggregate?.candidateValues ?? {}, spec, ...options });
}

export function createSelectionRequest({
  id = `SEL-${Date.now()}`,
  mode = "single",
  candidates = [],
  count = 1,
  minimum = mode === "up_to" ? 0 : count,
  maximum = count,
  label = "対象を選択",
  message = "",
  scopeField = null,
  scopeOptions = [],
  groups = [],
  budget = null,
  candidateValues = {},
  candidateLabels = {},
  continuation = null,
  spec = null,
  exactBudget = null,
  allocation = null,
  randomPools = []
} = {}) {
  if (!SELECTION_MODES.includes(mode)) throw new Error(`Unknown selection mode: ${mode}`);
  return {
    id,
    mode,
    candidates: [...new Set(candidates)],
    selected: [],
    count,
    minimum,
    maximum,
    label,
    message,
    scopeField,
    scopeOptions: [...new Set(scopeOptions)].sort((a, b) => String(a).localeCompare(String(b), "ja")),
    selectedScope: null,
    groups,
    budget,
    exactBudget,
    candidateValues,
    candidateLabels,
    allocation,
    randomPools,
    spec,
    continuation
  };
}

export function hasExactAggregateCombination({ candidates = [], candidateValues = {}, exactTotal, minimum = 0, maximum = candidates.length } = {}) {
  const target = Number(exactTotal);
  if (!Number.isFinite(target) || target < 0) return false;
  const reachable = Array.from({ length: Math.max(0, maximum) + 1 }, () => new Set());
  reachable[0].add(0);
  for (const candidate of [...new Set(candidates)]) {
    const value = Number(candidateValues?.[candidate]);
    if (!Number.isFinite(value) || value < 0) continue;
    for (let count = maximum - 1; count >= 0; count -= 1) {
      for (const sum of [...reachable[count]]) {
        if (sum + value <= target) reachable[count + 1].add(sum + value);
      }
    }
  }
  for (let count = Math.max(0, minimum); count <= maximum; count += 1) {
    if (reachable[count]?.has(target)) return true;
  }
  return false;
}

export function isSelectionRequestFeasible(request) {
  if (request.mode === "scope") return request.scopeOptions.length >= request.minimum;
  if (request.mode === "random") return request.candidates.length >= request.minimum;
  if (request.exactBudget !== null) return hasExactAggregateCombination({
    candidates: request.candidates,
    candidateValues: request.candidateValues,
    exactTotal: request.exactBudget,
    minimum: request.minimum,
    maximum: request.maximum
  });
  return request.candidates.length >= request.minimum;
}

export function toggleSelection(request, value) {
  if (!request.candidates.includes(value) || ["scope", "random"].includes(request.mode)) return request;
  if (request.selected.includes(value)) request.selected = request.selected.filter((item) => item !== value);
  else if (request.mode === "single") request.selected = [value];
  else if (request.selected.length < request.maximum) request.selected = [...request.selected, value];
  return request;
}

export function setSelectionScope(request, value) {
  if (request.mode === "scope" && request.scopeOptions.includes(value)) request.selectedScope = value;
  return request;
}

export function setAllocation(request, target, amount) {
  if (request.spec?.kind !== "allocation" || !request.candidates.includes(target)) return request;
  const value = Math.max(0, Math.trunc(Number(amount) || 0));
  const maximum = request.spec.maximumPerTarget;
  request.allocation[target] = maximum === null ? value : Math.min(value, maximum);
  if (value > 0 && !request.selected.includes(target)) request.selected = [...request.selected, target];
  if (value === 0) request.selected = request.selected.filter((item) => item !== target);
  return request;
}

export function canConfirmSelection(request) {
  if (!isSelectionRequestFeasible(request)) return false;
  if (request.mode === "scope") return request.selectedScope !== null;
  if (request.mode === "random") return request.candidates.length >= request.minimum;
  if (new Set(request.selected).size !== request.selected.length) return false;
  if (request.selected.some((value) => !request.candidates.includes(value))) return false;
  if (!(request.selected.length >= request.minimum && request.selected.length <= request.maximum)) return false;
  if (request.budget !== null && request.selected.reduce((sum, value) => sum + Number(request.candidateValues?.[value] ?? 0), 0) > request.budget) return false;
  if (request.exactBudget !== null && request.selected.reduce((sum, value) => sum + Number(request.candidateValues?.[value] ?? 0), 0) !== request.exactBudget) return false;
  if (request.spec?.kind === "allocation") {
    const entries = request.selected.map((target) => Number(request.allocation?.[target] ?? 0));
    if (request.selected.length === 0) return request.spec.allowNoTargets;
    if (entries.some((value) => value < request.spec.minimumPerTarget)) return false;
    return entries.reduce((sum, value) => sum + value, 0) === request.spec.total;
  }
  return (request.groups ?? []).every((group) => {
    const count = request.selected.filter((value) => group.candidates.includes(value)).length;
    return count >= group.minimum && count <= group.maximum;
  });
}

export function confirmSelection(request, random = Math.random) {
  if (!canConfirmSelection(request)) return null;
  if (request.mode === "scope") return request.spec?.kind === "choice" ? { choice: request.selectedScope, selected: [] } : { scope: request.selectedScope, selected: [] };
  if (request.mode === "random") {
    if (request.spec?.kind === "random_selection" && request.spec.perPool) {
      const selected = request.randomPools.flatMap((pool) => sampleWithoutReplacement(pool.candidates, Math.min(pool.count, pool.candidates.length), random));
      return { selected, random: true, byPool: true };
    }
    const pool = [...request.candidates];
    const selected = [];
    const amount = Math.min(request.count, pool.length);
    while (selected.length < amount) selected.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return { selected, random: true };
  }
  if (request.spec?.kind === "allocation") return { selected: [...request.selected], allocation: { ...request.allocation }, total: request.spec.total };
  return { selected: [...request.selected] };
}

function sampleWithoutReplacement(candidates, count, random) {
  const pool = [...candidates];
  const selected = [];
  while (selected.length < count && pool.length) selected.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return selected;
}

export function collectDeckScopeOptions(state, field) {
  const values = new Set();
  for (const player of Object.values(state.players)) {
    for (const zone of ["deck", "hand", "front", "back", "registry", "trash"]) {
      for (const card of player[zone]) {
        if (field === "category" && card.category) values.add(card.category);
        if (field === "class") {
          const classes = card.classes ?? card.cardClass ?? card.className ?? card.class
            ?? card.affiliation ?? card.tribe ?? card.species ?? card["所属"] ?? card["種族"];
          for (const value of Array.isArray(classes) ? classes : String(classes ?? "").split(/[\/／,]/)) {
            if (value.trim()) values.add(value.trim());
          }
        }
      }
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, "ja"));
}
