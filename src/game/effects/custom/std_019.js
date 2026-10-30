export function std019NotifyCardExecuted({ executedCard, scriptOwner }) {
  return Boolean(executedCard.color) && scriptOwner.hand.some((card) => card.color === executedCard.color);
}
