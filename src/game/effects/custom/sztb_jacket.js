import { createRuntimeCard } from "../../runtime/factory.js";
import { hydrateCard } from "../../core/setup.js";
import { emitCardsGenerated, placeByMode } from "../generic/placement.js";

export function sztbJacketPlaceSelection(state, continuation, result, playerId, player) {
  const zone = result.scope === "バック" ? "back" : "front";
  const jacket = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "SZTB-091", playerId, ++state.tokenSerial + 900));
  emitCardsGenerated(state, playerId, [jacket], continuation.sourceName);
  placeByMode(state, playerId, jacket, { zone, mode: "forced-effect", from: "generated", source: continuation.sourceName });
  state.pending = null;
  return true;
}
