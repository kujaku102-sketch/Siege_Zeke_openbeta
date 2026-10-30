// STD-217 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { dealFortressDamage } from "../../game/core/battle.js";
import { runEffectEntry } from "../../game/core/effects.js";
import { otherPlayer } from "../../game/core/shared.js";

// handlers (was effects/custom/std_217.js)
export function std217DrainIndependentEffects({ state, next }) {
  runEffectEntry(state, next.kind, next.playerId, () => dealFortressDamage(state, otherPlayer(next.playerId), 1, next.playerId, next.sourceName));
}
