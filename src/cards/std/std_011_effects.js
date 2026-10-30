// STD-011 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)

// handlers (was effects/custom/std_011.js)
export function std011GetEffectTargets({ cards, targetPlayerId, player }) {
  return [...cards, { uid: `${targetPlayerId}-fortress`, name: player.user.name, category: "User" }];
}
