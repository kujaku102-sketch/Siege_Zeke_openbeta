import { isObCard } from "../../card-types.js";

export function std196GetEffectActivationTargets2({ player }) {
  return [...player.front, ...player.back].filter(isObCard);
}
