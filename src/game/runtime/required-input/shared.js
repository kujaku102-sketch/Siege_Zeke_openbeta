import { opaqueOrdinal } from '../opaque-id.js';

export const failure = code => ({ ok: false, error: { code } });
export const optionId = index => opaqueOrdinal('option', index);
export const groupId = index => opaqueOrdinal('group', index);
export const choiceId = (revision, source) => `choice:${revision}:${source}`;
export const seatForPlayer = (metadata, playerId) => metadata.seatIds[playerId === 'player' ? 0 : 1];

export const fixedPick = (minimum, maximum) => ({
  kind: 'pick', minimum, maximum, aggregate: null, groups: []
});
