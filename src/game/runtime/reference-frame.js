import { queryRuntimeLocations } from './query.js';

// Location/face-down projection does not need dynamic costs, stats, or keywords.
export function buildRuntimeReferenceFrame(engineState) {
  return queryRuntimeLocations(engineState);
}
