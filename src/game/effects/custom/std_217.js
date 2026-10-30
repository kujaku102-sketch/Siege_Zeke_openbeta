import { dealFortressDamage } from "../../core/battle.js";
import { runEffectEntry } from "../../core/effects.js";
import { otherPlayer } from "../../core/shared.js";

export function std217DrainIndependentEffects({ state, next }) {
  runEffectEntry(state, next.kind, next.playerId, () => dealFortressDamage(state, otherPlayer(next.playerId), 1, next.playerId, next.sourceName));
}
