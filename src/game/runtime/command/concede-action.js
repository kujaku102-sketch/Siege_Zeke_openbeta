import { MATCH_MODES } from '../modes.js';
import { prepared, reject } from './common.js';

// 降参 (rulebook 1.2): any seat, at any time of the match: on its own turn or not, with a choice open or not, before the first turn too.
// Only a finished match, or a mode that has no result (tutorial, lab, sandbox), refuses it.
export function prepareConcedeAction({ canonical, engine, metadata, trusted }) {
  if (!MATCH_MODES.includes(engine.mode) || engine.finished) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, { engineFunction: 'concedeGame', playerId: metadata.seatIds[0] === trusted.actorSeat ? 'player' : 'ai' });
}
