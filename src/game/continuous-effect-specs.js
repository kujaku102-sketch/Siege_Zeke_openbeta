import { collectSpecs } from "../cards/index.js";
import { EXECUTION_COST_MODIFIER_SPEC_ORDER } from "../cards/spec-order.js";

const freezeSpecs = (entries) => Object.freeze(Object.fromEntries(
  Object.entries(entries).map(([id, specs]) => [id, Object.freeze(specs.map((item) => Object.freeze(item)))])
));

export const CARD_CONTINUOUS_STAT_MODIFIER_SPECS = freezeSpecs(collectSpecs("continuousStatModifierSpec"));

export const CARD_CONDITIONAL_KEYWORD_SPECS = freezeSpecs(collectSpecs("conditionalKeywordSpec"));

export const CARD_MANDATORY_STATE_CHECK_SPECS = freezeSpecs(collectSpecs("mandatoryStateCheckSpec"));

export const CARD_PLAYER_VALUE_MODIFIER_SPECS = freezeSpecs(collectSpecs("playerValueModifierSpec"));

export const CARD_EXECUTION_COST_MODIFIER_SPECS = freezeSpecs(collectSpecs("executionCostModifierSpec", EXECUTION_COST_MODIFIER_SPEC_ORDER));

export const CARD_MOUNTED_STAT_MODIFIER_SPECS = freezeSpecs(collectSpecs("mountedStatModifierSpec"));

export const CARD_MOUNTED_KEYWORD_SPECS = freezeSpecs(collectSpecs("mountedKeywordSpec"));

export const CARD_MOUNT_EVENT_SPECS = freezeSpecs(collectSpecs("mountEventSpec"));

export const CARD_AURA_KEYWORD_SPECS = freezeSpecs(collectSpecs("auraKeywordSpec"));

export const CARD_AURA_BATTLE_STAT_SPECS = freezeSpecs(collectSpecs("auraBattleStatSpec"));

export const CARD_ATTACK_PERMISSION_SPECS = freezeSpecs(collectSpecs("attackPermissionSpec"));

export const CARD_DESTRUCTION_PERMISSION_SPECS = freezeSpecs(collectSpecs("destructionPermissionSpec"));

export const CARD_PLACEMENT_PERMISSION_SPECS = freezeSpecs(collectSpecs("placementPermissionSpec"));

const specsFor = (registry, cardId) => registry[cardId] ?? Object.freeze([]);

export const continuousStatModifierSpecsFor = (cardId) => specsFor(CARD_CONTINUOUS_STAT_MODIFIER_SPECS, cardId);
export const conditionalKeywordSpecsFor = (cardId) => specsFor(CARD_CONDITIONAL_KEYWORD_SPECS, cardId);
export const mandatoryStateCheckSpecsFor = (cardId) => specsFor(CARD_MANDATORY_STATE_CHECK_SPECS, cardId);
export const playerValueModifierSpecsFor = (cardId) => specsFor(CARD_PLAYER_VALUE_MODIFIER_SPECS, cardId);
export const executionCostModifierSpecsFor = (cardId) => specsFor(CARD_EXECUTION_COST_MODIFIER_SPECS, cardId);
export const mountedStatModifierSpecsFor = (cardId) => specsFor(CARD_MOUNTED_STAT_MODIFIER_SPECS, cardId);
export const mountedKeywordSpecsFor = (cardId) => specsFor(CARD_MOUNTED_KEYWORD_SPECS, cardId);
export const mountEventSpecsFor = (cardId) => specsFor(CARD_MOUNT_EVENT_SPECS, cardId);
export const auraKeywordSpecsFor = (cardId) => specsFor(CARD_AURA_KEYWORD_SPECS, cardId);
export const auraBattleStatSpecsFor = (cardId) => specsFor(CARD_AURA_BATTLE_STAT_SPECS, cardId);
export const attackPermissionSpecsFor = (cardId) => specsFor(CARD_ATTACK_PERMISSION_SPECS, cardId);
export const destructionPermissionSpecsFor = (cardId) => specsFor(CARD_DESTRUCTION_PERMISSION_SPECS, cardId);
export const placementPermissionSpecsFor = (cardId) => specsFor(CARD_PLACEMENT_PERMISSION_SPECS, cardId);
