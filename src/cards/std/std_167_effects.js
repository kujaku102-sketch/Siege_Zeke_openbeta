import { isObCard } from "../../game/card-types.js";
import { otherPlayer } from "../../game/core/shared.js";
import { cardCurrentStr } from "../../game/core/stats.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";

// handlers (was effects/custom/std_167.js)
export function std167ResponseCardApplicable({ opponent, state, playerId }) {
  return [...opponent.front, ...opponent.back].some((target) => isObCard(target) && cardCurrentStr(state, otherPlayer(playerId), target) < Number(state.players[playerId].damageReceivedThisTurn ?? 0));
}

export function std167ResolveDeclaredResponse({ state, playerId, targetUid, card }) {
  destroyCard(state, otherPlayer(playerId), targetUid, { source: card.name });
}
