import { isObCard } from "../../card-types.js";

export function sztb096GetEffectTargets({ cards }) {
  return cards.filter(isObCard);
}
