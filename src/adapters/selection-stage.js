// One card from each of several separate groups (own Ob, then enemy Ob) is asked
// one group at a time, in the order the effect text names them.
const stagedGroups = request => {
  const c = request?.constraints, groups = c?.groups ?? [];
  if (c?.kind !== 'pick' || groups.length < 2 || c.minimum !== groups.length || c.maximum !== groups.length
    || groups.some(group => group.minimum !== 1 || group.maximum !== 1)) return null;
  const ids = groups.flatMap(group => group.optionIds);
  return new Set(ids).size === ids.length ? groups : null;
};

// The group still waiting for its pick; index === total once every group has one.
export function selectionStage(request, answer) {
  const groups = stagedGroups(request);
  if (!groups) return null;
  const picked = new Set(answer?.requestId === request.requestId ? answer.optionIds : []);
  const index = groups.findIndex(group => !group.optionIds.some(id => picked.has(id)));
  const current = index < 0 ? groups.length : index;
  return { index: current, total: groups.length, optionIds: [...(groups[current]?.optionIds ?? [])] };
}

// Ids sharing a staged group with optionId: picking one replaces the others.
export const stageGroupIds = (request, optionId) =>
  stagedGroups(request)?.find(group => group.optionIds.includes(optionId))?.optionIds ?? null;

export function stagedInteraction(interaction, stage) {
  if (!interaction || !stage) return interaction;
  return { ...interaction, options: interaction.options.filter(option => stage.optionIds.includes(option.optionId)) };
}

// A card that can also be set as a Script answers one placement two ways on the same back
// slots (as itself, or set as a Script). The bar's toggle picks the way; the board lights
// only that way's options (文豪, 2026-11-05, H3).
export const PLACEMENT_MODES = ['card', 'script'];
export const placementModes = request => {
  const options = request?.options ?? [];
  const script = options.filter(option => option?.kind === 'asScript').length;
  return script > 0 && script < options.length ? PLACEMENT_MODES : null;
};
export const modeOptionIds = (request, mode) => new Set(request.options
  .filter(option => (option.kind === 'asScript') === (mode === 'script')).map(option => option.optionId));
export function modeInteraction(interaction, request, mode) {
  if (!interaction || !placementModes(request)) return interaction;
  const ids = modeOptionIds(request, mode);
  return { ...interaction, options: interaction.options.filter(option => ids.has(option.optionId)) };
}
