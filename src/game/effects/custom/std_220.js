export function std220PlayCardCore3({ card, state, registryExecution }) {
  if (registryExecution) {
    card.std220RegistryExecutedTurn = state.turnNumber;
  }
}
