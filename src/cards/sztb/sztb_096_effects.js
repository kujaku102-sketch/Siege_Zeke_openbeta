import { isObCard } from "../../game/card-types.js";
import { createRuntimeCard } from "../../game/runtime/factory.js";
import { hydrateCard } from "../../game/core/setup.js";
import { emitCardsGenerated } from "../../game/effects/generic/generate.js";
import { placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/sztb_096.js)
export function sztb096GetEffectTargets({ cards }) {
  return cards.filter(isObCard);
}

// The arms band jacket Sps (SZTB-096 to 099) place a jacket after their text, before the Sp goes to the trash.
export function sztb096SpellCleanupExtra() {
  return { postEffect: "arms-band-jacket", postEffectDone: false };
}

// handlers (was effects/custom/sztb_jacket.js)
export function sztbJacketPlaceSelection(state, continuation, result, playerId, player) {
  const zone = result.scope === "バック" ? "back" : "front";
  const jacket = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "SZTB-091", playerId, ++state.tokenSerial + 900));
  emitCardsGenerated(state, playerId, [jacket], continuation.sourceName);
  placeByMode(state, playerId, jacket, { zone, mode: "forced-effect", from: "generated", source: continuation.sourceName });
  state.pending = null;
  return true;
}
