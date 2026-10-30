
import { CARD_LIBRARY } from "../data/cards.js";
import { compileEffectText } from "../../packages/effect-compiler/index.js";
import { CARD_DAMAGE_MODIFIER_SPECS } from "./damage-modifier-specs.js";
import {
  CARD_CONDITIONAL_KEYWORD_SPECS,
  CARD_CONTINUOUS_STAT_MODIFIER_SPECS,
  CARD_ATTACK_PERMISSION_SPECS,
  CARD_AURA_BATTLE_STAT_SPECS,
  CARD_AURA_KEYWORD_SPECS,
  CARD_DESTRUCTION_PERMISSION_SPECS,
  CARD_EXECUTION_COST_MODIFIER_SPECS,
  CARD_MANDATORY_STATE_CHECK_SPECS,
  CARD_MOUNTED_KEYWORD_SPECS,
  CARD_MOUNT_EVENT_SPECS,
  CARD_MOUNTED_STAT_MODIFIER_SPECS,
  CARD_PLACEMENT_PERMISSION_SPECS,
  CARD_PLAYER_VALUE_MODIFIER_SPECS
} from "./continuous-effect-specs.js";
import { SHARED_TRIGGER_CARD_IDS } from "./trigger-specs.js";
import { SHARED_SELECTION_MODULE_CARD_IDS } from "../cards/compiler-presets.js";
import { collectSpecs } from "../cards/index.js";
import { RUNTIME_SPEC_ORDER } from "../cards/spec-order.js";

export const CARD_PLACEMENT_COST_SPECS = Object.freeze(collectSpecs("placementCostSpec"));

// ID is used only at this registry boundary. The engine executes the same operation
// vocabulary for every registered card and does not own card-specific effect bodies.
export const CARD_RUNTIME_SPECS = Object.freeze(collectSpecs("runtimeSpec", RUNTIME_SPEC_ORDER));

export const CARD_BATTLE_STAT_MODIFIER_SPECS = Object.freeze(collectSpecs("battleStatModifierSpec"));

export function battleStatModifierSpecsFor(cardId) {
  return CARD_BATTLE_STAT_MODIFIER_SPECS[cardId] ?? Object.freeze([]);
}

const phasesFor = (card, compiled) => {
  const phases = new Set();
  if (card.category === "Sp") phases.add("spell");
  for (const keyword of compiled.keywords) {
    if (["LOGIN", "LOGOUT", "RESPONSE", "UPDATE", "RESIDENT", "IF"].includes(keyword.name)) {
      phases.add(keyword.name.toLowerCase());
    }
  }
  for (const clause of compiled.clauses) {
    for (const trigger of clause.triggers ?? []) phases.add(trigger.type);
  }
  if (!phases.size) phases.add("continuous");
  return Object.freeze([...phases]);
};

const SHARED_INTRINSIC_OPERATION_TYPES = new Set([
  "intrinsic_component",
  "intrinsic_keyword",
  "intrinsic_keywords",
  "intrinsic_destruction_replacement",
  "response_no_additional_effect",
  "madness_counter_rule"
]);

const compilerBodyIsIntrinsic = (compiled) => compiled.status === "supported"
  && compiled.operations.length > 0
  && compiled.operations.every((item) => SHARED_INTRINSIC_OPERATION_TYPES.has(item.type));

const compilerBodyIsKeywordOnly = (compiled) => compiled.operations.length === 0
  && compiled.keywords.length > 0
  && compiled.warnings.length === 0
  && compiled.normalizedText.replace(/\[[^\]]+\]/g, "").trim() === "";

const compilerBodyIsCoveredByModifierRegistry = (id, compiled) => {
  if (CARD_DAMAGE_MODIFIER_SPECS[id]
    && compiled.operations.length > 0
    && compiled.operations.every((item) => ["modify_damage", "battle_outgoing_damage_replacement"].includes(item.type))) return true;
  return Boolean(CARD_BATTLE_STAT_MODIFIER_SPECS[id]
    && compiled.operations.length > 0
    && compiled.operations.every((item) => item.type === "battle_stat_variable"));
};

const compilerBodyIsCoveredByContinuousRegistry = (id, compiled) => {
  if (CARD_AURA_KEYWORD_SPECS[id]
    && compiled.operations.length > 0
    && compiled.operations.every((item) => item.type === "resident_grant_keyword_group")) return true;
  if (CARD_ATTACK_PERMISSION_SPECS[id]
    && compiled.operations.length > 0
    && compiled.operations.every((item) => ["attack_permission", "mandatory_attack"].includes(item.type))) return true;
  return Boolean(CARD_PLACEMENT_PERMISSION_SPECS[id]
    && compiled.operations.length > 0
    && compiled.operations.every((item) => item.type === "execution_restriction"));
};

// Every public card crosses this registry before an instance enters the game.
// `shared_spec` means its effect body is declarative here. `custom_adapter`
// identifies the already-tested engine adapter while it is migrated piecemeal;
// parser status is kept separate and never presented as runtime completion.
export const CARD_RUNTIME_ROUTES = Object.freeze(Object.fromEntries(
  Object.entries(CARD_LIBRARY).map(([id, card]) => {
    const compiled = compileEffectText(card.text, { id, category: card.category });
    return [id, Object.freeze({
      id,
      execution: CARD_RUNTIME_SPECS[id]
        || CARD_CONTINUOUS_STAT_MODIFIER_SPECS[id]
        || CARD_CONDITIONAL_KEYWORD_SPECS[id]
        || CARD_AURA_BATTLE_STAT_SPECS[id]
        || CARD_MANDATORY_STATE_CHECK_SPECS[id]
        || CARD_PLAYER_VALUE_MODIFIER_SPECS[id]
        || CARD_EXECUTION_COST_MODIFIER_SPECS[id]
        || CARD_MOUNTED_STAT_MODIFIER_SPECS[id]
        || CARD_MOUNTED_KEYWORD_SPECS[id]
        || CARD_MOUNT_EVENT_SPECS[id]
        || CARD_DESTRUCTION_PERMISSION_SPECS[id]
        || SHARED_TRIGGER_CARD_IDS.includes(id)
        || SHARED_SELECTION_MODULE_CARD_IDS.includes(id)
        || compilerBodyIsCoveredByModifierRegistry(id, compiled)
        || compilerBodyIsCoveredByContinuousRegistry(id, compiled)
        ? "shared_spec"
        : (compiled.status === "supported" && (compiled.operations.length === 0 || compilerBodyIsIntrinsic(compiled)))
          || compilerBodyIsKeywordOnly(compiled)
          ? "shared_intrinsic"
          : "custom_adapter",
      parserStatus: compiled.status,
      damageModifier: CARD_DAMAGE_MODIFIER_SPECS[id] ? "shared_modifier" : null,
      battleStatModifier: CARD_BATTLE_STAT_MODIFIER_SPECS[id] ? "shared_modifier" : null,
      phases: phasesFor(card, compiled)
    })];
  })
));

export function cardRuntimeRoute(cardId) {
  return CARD_RUNTIME_ROUTES[cardId] ?? null;
}

export function cardRuntimeSpec(cardId, phase) {
  const found = CARD_RUNTIME_SPECS[cardId] ?? null;
  if (!found) return null;
  if (found.phases) return found.phases[phase] ?? null;
  return found.phase === phase ? found : null;
}

export function cardPlacementCostSpec(cardId) {
  return CARD_PLACEMENT_COST_SPECS[cardId] ?? null;
}

export function registeredCardRuntimeIds() {
  return Object.keys(CARD_RUNTIME_ROUTES);
}

export function sharedCardRuntimeIds() {
  return Object.values(CARD_RUNTIME_ROUTES)
    .filter((route) => route.execution === "shared_spec")
    .map((route) => route.id);
}
