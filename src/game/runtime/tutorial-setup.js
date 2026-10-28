import { DECK_OPTIONS } from '../engine.js';

// One table for the tutorials the runtime may start. A tutorial scripts both sides, so the decks it
// is started with must hold the cards the script plays. A tutorial whose engine setup forces a side's
// deck names it here: the state reports that deck, and the recipe check reads its recipe (or the
// recipe the caller supplies) instead of the deck id the caller sent.
const TUTORIALS = Object.freeze({
  basics: Object.freeze({
    player: ['STD-076', 'STD-075', 'STD-090', 'STD-086'], fixedPlayerDeck: null,
    ai: ['STD-125', 'STD-131', 'STD-149', 'STD-129', 'STD-138'], fixedAiDeck: null
  }),
  vengeance: Object.freeze({ player: [], fixedPlayerDeck: 'vengeance', ai: ['STD-125', 'STD-131', 'STD-149'], fixedAiDeck: null }),
  // The player's deck holds the two Sp the script draws or accesses; the opponent plays Merc from a colourless deck.
  blue: Object.freeze({ player: ['STD-111', 'STD-116'], fixedPlayerDeck: 'tutorial-blue', ai: ['STD-043'], fixedAiDeck: 'tutorial-sandbag' })
});

export const TUTORIAL_IDS = Object.freeze(Object.keys(TUTORIALS));
export const isTutorialId = value => typeof value === 'string' && Object.hasOwn(TUTORIALS, value);

// The deck ids a tutorial game reports in its state.
export const tutorialPlayerDeckId = (tutorialId, playerDeckId) => TUTORIALS[tutorialId]?.fixedPlayerDeck ?? playerDeckId;
export const tutorialAiDeckId = (tutorialId, aiDeckId) => TUTORIALS[tutorialId]?.fixedAiDeck ?? aiDeckId;

const contains = (rows, ids) => ids.every(id => rows.some(([definition, count]) => definition === id && count > 0));

// options: tutorialId, playerDeckId, aiDeckId, playerDeckRecipe, aiDeckRecipe (already validated shapes).
export function tutorialSetupValid(options) {
  const tutorial = TUTORIALS[options.tutorialId];
  if (!tutorial) return false;
  const recipeOf = (supplied, fixedDeck, deckId) => supplied ?? DECK_OPTIONS[fixedDeck ?? deckId]?.recipe;
  const aiRecipe = recipeOf(options.aiDeckRecipe, tutorial.fixedAiDeck, options.aiDeckId);
  const playerRecipe = recipeOf(options.playerDeckRecipe, tutorial.fixedPlayerDeck, options.playerDeckId);
  return Boolean(aiRecipe && playerRecipe) && contains(aiRecipe, tutorial.ai) && contains(playerRecipe, tutorial.player);
}
