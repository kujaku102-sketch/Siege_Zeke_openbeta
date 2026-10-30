import { isObCard } from "../../card-types.js";

export function std018NotifyCardExecuted({ scriptOwnerId, executingPlayerId, executedCard }) {
  return scriptOwnerId !== executingPlayerId && isObCard(executedCard);
}
