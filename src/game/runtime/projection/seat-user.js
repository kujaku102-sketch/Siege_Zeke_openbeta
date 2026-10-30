import { MISSING, dense, finite, integer, own, text } from './guards.js';

export function publicUser(player) {
  const user = own(player, 'user');
  const result = {};
  for (const [output, source] of [
    ['definitionId', 'id'], ['name', 'name'], ['abilityKey', 'abilityKey'],
    ['abilityName', 'abilityName'], ['abilityText', 'ability']
  ]) result[output] = text(own(user, source));
  result.maxFortressStr = finite(own(user, 'maxStr'));
  result.frontLimit = integer(own(user, 'frontLimit'));
  result.backLimit = integer(own(user, 'backLimit'));
  result.initialHand = integer(own(user, 'initialHand'));
  result.memory = integer(own(user, 'memory'));
  // No user card has a deck rule yet; one would be a short rule text.
  const deckRule = own(user, 'deckRule', true);
  result.deckRule = deckRule === MISSING || deckRule === null ? null : text(deckRule);
  result.incidents = dense(own(user,'incidents')).map(value => finite(value));
  return result;
}
