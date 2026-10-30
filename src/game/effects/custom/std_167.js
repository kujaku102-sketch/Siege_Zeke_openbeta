import { isObCard } from "../../card-types.js";
import { cardCurrentStr } from "../../core/battle.js";
import { otherPlayer } from "../../core/shared.js";
import { destroyCard } from "../generic/placement.js";

export function std167ResponseCardApplicable({ opponent, state, playerId }) {
  return [...opponent.front, ...opponent.back].some((target) => isObCard(target) && cardCurrentStr(state, otherPlayer(playerId), target) < Number(state.players[playerId].damageReceivedThisTurn ?? 0));
}

export function std167ResolveDeclaredResponse({ state, playerId, targetUid, card }) {
  destroyCard(state, otherPlayer(playerId), targetUid, { source: card.name });
}
