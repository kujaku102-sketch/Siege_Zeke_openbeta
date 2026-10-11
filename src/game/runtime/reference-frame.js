import { buildRuntimeIdentityIndex } from './bridge.js';
import { queryRuntimeCard } from './query.js';

const failure = code => ({ ok: false, error: { code } });

function copyLocation(location) {
  return location.kind === 'mounted'
    ? { ...location, host: { ...location.host } }
    : { ...location };
}

export function buildRuntimeReferenceFrame(engineState) {
  const built = buildRuntimeIdentityIndex(engineState);
  if (!built.ok) return built;
  const context = engineState?.runtimeContext;
  const seatIds = context?.seatIds;
  if (!Array.isArray(seatIds) || seatIds.length !== 2 || seatIds.some(seat => typeof seat !== 'string' || seat.length === 0)
    || seatIds[0] === seatIds[1]) return failure('RUNTIME_INVALID_REFERENCE_FRAME');
  const cards = [];
  for (const entry of built.value.entries) {
    const queried = queryRuntimeCard(engineState, { identity: entry.identity, keywordNames: [] });
    if (!queried.ok) return queried;
    cards.push({
      identity: { ...entry.identity }, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
      location: copyLocation(entry.location), faceDown: queried.value.state.faceDown
    });
  }
  return { ok: true, value: { matchId: built.value.matchId, seatIds: [...seatIds], cards } };
}
