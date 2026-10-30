import { isObCard } from "../../card-types.js";
import { hasClass } from "../../core/shared.js";

export function std047ResponseCardApplicable({ state, playerId }) {
  return state.players[playerId].deck.some((target) => isObCard(target) && hasClass(target, "フィクサー"));
}
