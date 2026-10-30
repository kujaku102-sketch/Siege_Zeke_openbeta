// STD-196 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";

// handlers (was effects/custom/std_196.js)
export function std196GetEffectActivationTargets2({ player }) {
  return [...player.front, ...player.back].filter(isObCard);
}
