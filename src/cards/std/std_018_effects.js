// STD-018 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";

// handlers (was effects/custom/std_018.js)
export function std018NotifyCardExecuted({ scriptOwnerId, executingPlayerId, executedCard }) {
  return scriptOwnerId !== executingPlayerId && isObCard(executedCard);
}
