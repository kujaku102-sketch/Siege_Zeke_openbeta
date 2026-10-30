// STD-237 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { CARD_LIBRARY } from "../../data/cards.js";
import { isObCard } from "../../game/card-types.js";
import { hasKeyword } from "../../game/effect-compiler.js";
import { createRuntimeCard } from "../../game/runtime/factory.js";
import { hydrateCard } from "../../game/core/setup.js";
import { fail } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { emitCardsGenerated, emitEffectPlacement, placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_237.js)
export function std237ActivateCardEffectCore({ player, state, effect, playerId, card }) {
  if (effect.kind === "update") {
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const ids = Object.values(CARD_LIBRARY).filter((item) => isObCard(item) && !item.token && item.id !== "STD-237").map((item) => item.id);
    if (!ids.length) return fail(state, "生成候補のObがない。", false);
    player.memory -= effect.cost;
    const generated = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, ids[Math.floor(state.rng() * ids.length)], playerId, ++state.tokenSerial + 23700));
    emitCardsGenerated(state, playerId, [generated], card.name);
    generated.summoningSick = !hasKeyword(generated, "QA");
    if (placeByMode(state, playerId, generated, { zone, from: "generated", source: card.name }) === "placed") {
      emitEffectPlacement(state, playerId, generated, zone, card.name);
    }
    return true;
  }
  return PASS;
}
