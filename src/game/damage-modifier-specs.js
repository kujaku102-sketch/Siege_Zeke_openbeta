
import { collectSpecs } from "../cards/index.js";

// Card IDs are confined to this registry boundary. The engine evaluates every
// active provider through the same source / target / direction matcher.
export const CARD_DAMAGE_MODIFIER_SPECS = Object.freeze(collectSpecs("damageModifierSpecs"));

export function damageModifierSpecsFor(cardId) {
  return CARD_DAMAGE_MODIFIER_SPECS[cardId] ?? Object.freeze([]);
}
