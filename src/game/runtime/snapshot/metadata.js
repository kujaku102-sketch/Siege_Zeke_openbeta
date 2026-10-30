import { DECK_OPTIONS } from '../../engine.js';
import { CARD_LIBRARY, USER_CARDS } from '../../../data/cards.js';
import { isTutorialId, tutorialSetupValid } from '../tutorial-setup.js';
import { UNSUPPORTED, dense, exact, nonempty, ordinary, reject, seatIds } from './guards.js';

const META_KEYS = ['matchId', 'seatIds', 'ruleVersion', 'cardVersion', 'startOptions'];
const OPTION_KEYS = ['mode', 'tutorialId', 'playerDeckId', 'aiDeckId', 'playerDeckRecipe', 'aiDeckRecipe', 'playerUserId', 'aiUserId', 'sandboxDeckSetup'];

const defaults = {
  mode: 'ai', tutorialId: 'basics', playerDeckId: 'red', aiDeckId: 'yellow', playerDeckRecipe: null, aiDeckRecipe: null,
  playerUserId: 'doors_zx', aiUserId: 'doors_zx', sandboxDeckSetup: false
};

function recipeData(input, code) {
  if (input === null) return null;
  const rows = dense(input, code);
  let total = 0;
  return rows.map(row => {
    const pair = dense(row, code);
    if (pair.length !== 2 || typeof pair[0] !== 'string' || !Object.hasOwn(CARD_LIBRARY, pair[0])
      || !Number.isSafeInteger(pair[1]) || pair[1] <= 0 || Object.is(pair[1], -0)) reject(code);
    total += pair[1];
    if (!Number.isSafeInteger(total)) reject(code);
    return [pair[0], pair[1]];
  });
}

function optionsData(input, code) {
  // Stored only for v2.4 matches; a legacy match's options keep exactly the nine original keys.
  ordinary(input, code);
  const supplied = exact(input, Object.hasOwn(input, 'openingProtocol') ? [...OPTION_KEYS, 'openingProtocol'] : OPTION_KEYS, code);
  const result = { ...defaults, ...supplied };
  if (typeof result.mode !== 'string' || !['ai', 'tutorial', 'lab', 'sandbox'].includes(result.mode)) reject(code);
  if (['lab', 'sandbox'].includes(result.mode)) reject(UNSUPPORTED);
  if (!isTutorialId(result.tutorialId)) reject(code);
  for (const key of ['playerDeckId', 'aiDeckId']) if (typeof result[key] !== 'string' || !Object.hasOwn(DECK_OPTIONS, result[key])) reject(code);
  for (const key of ['playerUserId', 'aiUserId']) if (typeof result[key] !== 'string' || !Object.hasOwn(USER_CARDS, result[key])) reject(code);
  if (typeof result.sandboxDeckSetup !== 'boolean') reject(code);
  if (Object.hasOwn(result, 'openingProtocol') && (result.openingProtocol !== 'v2.4' || result.mode !== 'ai')) reject(code);
  for (const key of ['playerDeckRecipe', 'aiDeckRecipe']) result[key] = recipeData(result[key], code);
  if (result.mode === 'tutorial' && !tutorialSetupValid(result)) reject(code);
  return result;
}

export function metadataData(input, code) {
  const metadata = exact(input, META_KEYS, code);
  if (!nonempty(metadata.matchId) || !nonempty(metadata.ruleVersion) || !nonempty(metadata.cardVersion)) reject(code);
  metadata.seatIds = seatIds(metadata.seatIds, code);
  metadata.startOptions = optionsData(metadata.startOptions, code);
  return metadata;
}
