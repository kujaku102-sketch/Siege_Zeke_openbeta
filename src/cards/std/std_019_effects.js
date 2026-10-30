// STD-019 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)

// handlers (was effects/custom/std_019.js)
export function std019NotifyCardExecuted({ executedCard, scriptOwner }) {
  return Boolean(executedCard.color) && scriptOwner.hand.some((card) => card.color === executedCard.color);
}
