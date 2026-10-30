import { collectFlagged, collectSpecs } from "./index.js";
import { COMPILER_PRESET_ORDER, SHARED_SELECTION_MODULE_ORDER } from "./spec-order.js";

// What the card side hands to the effect-compiler SDK (see data/cards.js, which registers it).
export const COMPILER_PRESETS = Object.freeze(collectSpecs("compilerPreset", COMPILER_PRESET_ORDER));
export const INTRINSIC_KEYWORDS = Object.freeze(collectSpecs("intrinsicKeywords"));
export const SHARED_SELECTION_MODULE_CARD_IDS = Object.freeze(collectFlagged("sharedSelectionModuleCard", SHARED_SELECTION_MODULE_ORDER));
