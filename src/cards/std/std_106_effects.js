import { createRuntimeCard } from "../../game/runtime/factory.js";
import { hydrateCard } from "../../game/core/setup.js";
import { PASS } from "../../game/effects/custom/index.js";
import { emitEffectPlacement, placeByMode } from "../../game/effects/generic/placement.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_106.js)
export function std106AttackCore4({ attacker, player, state, playerId }) {
  if (!attacker.resolvingStd106Attack) {
    attacker.resolvingStd106Attack = true;
    for (let index = 0; index < 2; index += 1) {
      const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const junk = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-078", playerId, ++state.tokenSerial + 1600));
      if (placeByMode(state, playerId, junk, { zone: zoneName, from: "generated", source: attacker.name }) === "placed") emitEffectPlacement(state, playerId, junk, zoneName, attacker.name);
    }
  }
}

export function std106ActivateCardEffectCore({ player, effect, card, state, playerId }) {
  if (effect.kind === "proxy") {
    let zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : null;
    if (!zoneName) zoneName = "front";
    player.memory -= effect.cost;
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    moveCardToTrash(state, playerId, player.hand.splice(sourceIndex, 1)[0], card.name);
    const junk = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-078", playerId, ++state.tokenSerial + 1600));
    if (placeByMode(state, playerId, junk, { zone: zoneName, from: "generated", source: card.name }) === "placed") emitEffectPlacement(state, playerId, junk, zoneName, card.name);
    return true;
  }
  return PASS;
}
