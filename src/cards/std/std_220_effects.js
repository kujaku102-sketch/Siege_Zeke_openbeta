// STD-220 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)

// handlers (was effects/custom/std_220.js)
export function std220PlayCardCore3({ card, state, registryExecution }) {
  if (registryExecution) {
    card.std220RegistryExecutedTurn = state.turnNumber;
  }
}
