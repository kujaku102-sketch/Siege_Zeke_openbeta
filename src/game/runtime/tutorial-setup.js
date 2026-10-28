import { DECK_OPTIONS } from '../engine.js';

// One table for the tutorials the runtime may start. A tutorial scripts both sides, so the
// decks it is started with must hold the cards the script plays; a tutorial that fixes the
// player's deck names it here and skips the player-side check.
const TUTORIALS = Object.freeze({
  basics: Object.freeze({
    player: ['STD-076', 'STD-075', 'STD-090', 'STD-086'], fixedPlayerDeck: null,
    ai: ['STD-125', 'STD-131', 'STD-149', 'STD-129', 'STD-138']
  }),
  vengeance: Object.freeze({ player: [], fixedPlayerDeck: 'vengeance', ai: ['STD-125', 'STD-131', 'STD-149'] }),
  // The engine deals the player's four-card hand itself (STD-107/023/109/110) from the legacy blue deck.
  blue: Object.freeze({ player: [], fixedPlayerDeck: 'neutron', ai: ['STD-043'] })
});

export const TUTORIAL_IDS = Object.freeze(Object.keys(TUTORIALS));
export const isTutorialId = value => typeof value === 'string' && Object.hasOwn(TUTORIALS, value);

// The player deck id a tutorial game reports in its state.
export const tutorialPlayerDeckId = (tutorialId, playerDeckId) => TUTORIALS[tutorialId]?.fixedPlayerDeck ?? playerDeckId;

const contains = (rows, ids) => ids.every(id => rows.some(([definition, count]) => definition === id && count > 0));

// options: tutorialId, playerDeckId, aiDeckId, playerDeckRecipe, aiDeckRecipe (already validated shapes).
export function tutorialSetupValid(options) {
  const tutorial = TUTORIALS[options.tutorialId];
  if (!tutorial) return false;
  const aiRecipe = options.aiDeckRecipe ?? DECK_OPTIONS[options.aiDeckId].recipe;
  if (!contains(aiRecipe, tutorial.ai)) return false;
  if (tutorial.fixedPlayerDeck !== null) return true;
  return contains(options.playerDeckRecipe ?? DECK_OPTIONS[options.playerDeckId].recipe, tutorial.player);
}
