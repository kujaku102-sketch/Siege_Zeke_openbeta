// STD-047 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { hasClass } from "../../game/core/shared.js";

// handlers (was effects/custom/std_047.js)
export function std047ResponseCardApplicable({ state, playerId }) {
  return state.players[playerId].deck.some((target) => isObCard(target) && hasClass(target, "フィクサー"));
}
