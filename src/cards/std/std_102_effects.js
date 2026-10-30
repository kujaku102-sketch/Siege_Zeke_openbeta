import { continueAttackAfterCost } from "../../game/core/battle.js";
import { findCard } from "../../game/core/shared.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";
import { placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_102.js)
export function std102PlaceSelection(state, continuation, result, playerId, player) {
  const source = findCard(state, continuation.sourceUid)?.card;
  for (const uid of result.selected) {
    const index = player.trash.findIndex((card) => card.uid === uid);
    if (index < 0) continue;
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const [card] = player.trash.splice(index, 1);
    placeByMode(state, playerId, card, { zone, from: "trash", source: continuation.sourceName, suppressScriptWindow: true });
  }
  state.pending = null;
  if (source && source.mounted.length === 0) destroyCard(state, playerId, source.uid, { source: `${source.name}のレイヤー閾値` });
  const sourceLocation = source ? findCard(state, source.uid) : null;
  return sourceLocation && ["front", "back"].includes(sourceLocation.zoneName)
    ? continueAttackAfterCost(state, playerId, source.uid, continuation.targetUid)
    : true;
}
