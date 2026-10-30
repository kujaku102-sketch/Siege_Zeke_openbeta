import { isObCard } from "../../card-types.js";

export function sztb096GetEffectTargets({ cards }) {
  return cards.filter(isObCard);
}

// The arms band jacket Sps (SZTB-096 to 099) place a jacket after their text, before the Sp goes to the trash.
export function sztb096SpellCleanupExtra() {
  return { postEffect: "arms-band-jacket", postEffectDone: false };
}
