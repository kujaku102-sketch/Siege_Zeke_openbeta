// STD-238 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { continueAttackAfterCost } from "../../game/core/battle.js";

// handlers (was effects/custom/std_238.js)
export function std238ResolveCardSelectionCore({ source, state, playerId, continuation }) {
  source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
  return continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid, { standbyAfter: true });
}
