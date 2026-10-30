export function std011GetEffectTargets({ cards, targetPlayerId, player }) {
  return [...cards, { uid: `${targetPlayerId}-fortress`, name: player.user.name, category: "User" }];
}
