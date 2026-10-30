import test from "node:test";
import assert from "node:assert/strict";
import { CARD_LIBRARY } from "../src/data/cards.js";
import {
  CARD_RUNTIME_ROUTES,
  CARD_RUNTIME_SPECS,
  CARD_PLACEMENT_COST_SPECS,
  CARD_BATTLE_STAT_MODIFIER_SPECS,
  battleStatModifierSpecsFor,
  cardPlacementCostSpec,
  cardRuntimeRoute,
  cardRuntimeSpec,
  registeredCardRuntimeIds,
  sharedCardRuntimeIds
} from "../src/game/card-runtime-specs.js";
import { EFFECT_OPERATION_TYPES, selector } from "../src/game/effect-operation-library.js";
import { optionalSpecsForCard } from "../src/game/trigger-specs.js";
import { CARD_DAMAGE_MODIFIER_SPECS, damageModifierSpecsFor } from "../src/game/damage-modifier-specs.js";
import {
  CARD_CONDITIONAL_KEYWORD_SPECS,
  CARD_CONTINUOUS_STAT_MODIFIER_SPECS,
  CARD_DESTRUCTION_PERMISSION_SPECS,
  CARD_ATTACK_PERMISSION_SPECS,
  CARD_AURA_KEYWORD_SPECS,
  CARD_EXECUTION_COST_MODIFIER_SPECS,
  CARD_MANDATORY_STATE_CHECK_SPECS,
  CARD_MOUNT_EVENT_SPECS,
  CARD_MOUNTED_KEYWORD_SPECS,
  CARD_MOUNTED_STAT_MODIFIER_SPECS,
  CARD_PLACEMENT_PERMISSION_SPECS,
  CARD_PLAYER_VALUE_MODIFIER_SPECS,
  conditionalKeywordSpecsFor,
  continuousStatModifierSpecsFor,
  mandatoryStateCheckSpecsFor
} from "../src/game/continuous-effect-specs.js";
import { SHARED_TRIGGER_CARD_IDS, specsForEvent } from "../src/game/trigger-specs.js";
import { compileEffectText } from "../packages/effect-compiler/index.js";
import { SHARED_SELECTION_MODULE_CARD_IDS } from "../src/cards/compiler-presets.js";
import { LAYERED_CARD_IDS, layeredSpecFor, validatesLayeredSelection } from "../src/game/layered-specs.js";

let layeredEntrySerial = 0;
const layeredEntry = (id, zoneName = "front", playerId = "player", patch = {}) => ({
  playerId,
  zoneName,
  card: { ...CARD_LIBRARY[id], uid: `${playerId}-${zoneName}-${id}-${++layeredEntrySerial}`, mounted: [], faceDown: false, ...patch }
});

test("every printed Layered card has one shared material specification", () => {
  const printed = Object.values(CARD_LIBRARY).filter((card) => /\[レイヤード[:：]/.test(card.text)).map((card) => card.id).sort();
  assert.deepEqual([...LAYERED_CARD_IDS].sort(), printed);
  for (const id of printed) {
    const spec = layeredSpecFor(CARD_LIBRARY[id]);
    assert.ok(spec);
    assert.ok(Number.isFinite(spec.minimum));
    assert.ok(spec.groups.every((group) => group.minimum >= 1 && group.maximum >= group.minimum));
  }
});

test("all Layered material texts accept their proper owner and zone distributions", () => {
  const cases = {
    "STD-085": [layeredEntry("STD-078"), layeredEntry("STD-092", "back")],
    "STD-094": [layeredEntry("STD-092"), layeredEntry("STD-078", "back")],
    "STD-095": [layeredEntry("STD-094"), layeredEntry("STD-078", "back")],
    "STD-096": [layeredEntry("STD-094"), layeredEntry("STD-078", "back")],
    "STD-097": [layeredEntry("STD-094"), layeredEntry("STD-078", "back")],
    "STD-098": [layeredEntry("STD-094"), layeredEntry("STD-232", "back"), layeredEntry("STD-232")],
    "STD-099": [layeredEntry("STD-094"), layeredEntry("STD-078", "back")],
    "STD-102": [layeredEntry("STD-092"), layeredEntry("STD-078", "back")],
    "STD-106": [layeredEntry("STD-092"), layeredEntry("STD-094", "back")],
    "STD-195": [layeredEntry("STD-189"), layeredEntry("STD-189", "back")],
    "STD-205": [layeredEntry("STD-020")],
    "STD-232": [layeredEntry("STD-020"), layeredEntry("STD-021", "registry")],
    "STD-238": [layeredEntry("STD-020"), layeredEntry("STD-021", "registry")],
    "SZTB-092": [layeredEntry("SZTB-090", "hand")],
    "SZTB-093": [layeredEntry("SZTB-090", "hand"), layeredEntry("SZTB-091", "back")],
    "SZTB-094": [layeredEntry("SZTB-090", "hand"), layeredEntry("SZTB-091", "front"), layeredEntry("SZTB-096", "back")],
    "SZTB-095": [layeredEntry("SZTB-090", "hand"), layeredEntry("SZTB-091", "front"), layeredEntry("SZTB-096", "back")]
  };
  for (const [id, entries] of Object.entries(cases)) assert.equal(validatesLayeredSelection(CARD_LIBRARY[id], "player", entries), true, id);
});

test("Layered material specifications reject enemy, face-down, zone, and group mismatches", () => {
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["STD-205"], "player", [layeredEntry("STD-020", "front", "ai")]), false);
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["STD-205"], "player", [layeredEntry("STD-020", "front", "player", { faceDown: true })]), false);
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["STD-232"], "player", [layeredEntry("STD-020", "trash"), layeredEntry("STD-021", "registry")]), false);
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["SZTB-092"], "player", [layeredEntry("SZTB-090", "front")]), false);
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["SZTB-093"], "player", [layeredEntry("SZTB-090", "hand"), layeredEntry("SZTB-091", "hand")]), false);
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["STD-098"], "player", [layeredEntry("STD-094"), layeredEntry("STD-232", "back")]), false);
  assert.equal(validatesLayeredSelection(CARD_LIBRARY["STD-106"], "player", [layeredEntry("STD-092"), layeredEntry("STD-078", "back")]), false);
});

const FIRST_MIGRATION_IDS = [
  "SZTB-096", "SZTB-099",
  "STD-015", "STD-034", "STD-110", "STD-111", "STD-138", "STD-149", "STD-206",
  "STD-091", "STD-093", "STD-094", "STD-098", "STD-099", "STD-126", "STD-133", "STD-134", "STD-198", "STD-216", "STD-221"
];

const SECOND_MIGRATION_IDS = ["STD-010", "STD-011", "STD-013", "STD-014", "STD-032", "STD-033", "STD-035", "STD-143", "STD-166", "STD-222", "STD-233"];
const ACCESS_MIGRATION_IDS = ["STD-040", "STD-042", "STD-045", "STD-047", "STD-081", "STD-083", "STD-087", "STD-090"];
const LOGIN_MIGRATION_IDS = ["STD-030", "STD-089", "STD-125", "STD-144", "STD-205"];
const FILTERED_ACCESS_MIGRATION_IDS = ["STD-101", "STD-107", "STD-108", "STD-173", "STD-180"];
const MULTI_PHASE_ACCESS_MIGRATION_IDS = ["STD-128", "STD-158"];
const VARIABLE_EFFECT_MIGRATION_IDS = ["STD-137", "STD-146"];
const BASIC_LOGOUT_MIGRATION_IDS = ["STD-145", "STD-150", "STD-151", "STD-153", "STD-155"];
const ZONE_MOVE_MIGRATION_IDS = ["STD-113", "STD-152", "STD-182", "STD-213", "STD-236"];
const RESULT_MOVE_MIGRATION_IDS = ["STD-046", "STD-131", "STD-156", "STD-172", "STD-225"];
const CURRENT_MIGRATION_IDS = ["STD-016", "STD-017", "STD-018", "STD-019", "STD-031", "STD-036", "STD-037", "STD-038", "STD-041", "STD-082", "STD-100", "STD-114", "STD-117", "STD-135", "STD-154", "STD-176", "STD-186", "STD-234", "STD-235", "SZTB-092", "SZTB-093", "SZTB-102"];
const CONDITIONAL_MOVE_MIGRATION_IDS = ["STD-004", "STD-005", "STD-006", "STD-007", "STD-008", "STD-009", "STD-012", "STD-039", "STD-075", "STD-077", "STD-078", "STD-079", "STD-080", "STD-084", "STD-086", "STD-088", "STD-103", "STD-109", "STD-115", "STD-116", "STD-123", "STD-127", "STD-130", "STD-170", "STD-181", "STD-188", "STD-192", "STD-196", "STD-199", "STD-200", "STD-201", "STD-202", "STD-209", "STD-210", ...SHARED_TRIGGER_CARD_IDS, ...SHARED_SELECTION_MODULE_CARD_IDS];

function phaseSpecs(entry) {
  return entry.phases ? Object.values(entry.phases) : [entry];
}

test("shared card runtime migration keeps every explicit spec registered", () => {
  assert.deepEqual(sharedCardRuntimeIds().sort(), [...new Set([...FIRST_MIGRATION_IDS, ...SECOND_MIGRATION_IDS, ...ACCESS_MIGRATION_IDS, ...LOGIN_MIGRATION_IDS, ...FILTERED_ACCESS_MIGRATION_IDS, ...MULTI_PHASE_ACCESS_MIGRATION_IDS, ...VARIABLE_EFFECT_MIGRATION_IDS, ...BASIC_LOGOUT_MIGRATION_IDS, ...ZONE_MOVE_MIGRATION_IDS, ...RESULT_MOVE_MIGRATION_IDS, ...CURRENT_MIGRATION_IDS, ...CONDITIONAL_MOVE_MIGRATION_IDS])].sort());
  for (const id of FIRST_MIGRATION_IDS) assert.ok(CARD_LIBRARY[id], `${id} must exist in the public card library`);
});

test("every canonical public card has exactly one runtime route", () => {
  const libraryIds = Object.keys(CARD_LIBRARY).sort();
  assert.equal(libraryIds.length, 227);
  assert.ok(libraryIds.every((id) => /^(?:STD|SZTB)-\d{3}$/.test(id)));
  assert.deepEqual(registeredCardRuntimeIds().sort(), libraryIds);
  assert.deepEqual(Object.keys(CARD_RUNTIME_ROUTES).sort(), libraryIds);
  for (const id of libraryIds) {
    const route = cardRuntimeRoute(id);
    assert.equal(route.id, id);
    assert.ok(["shared_spec", "shared_intrinsic", "custom_adapter"].includes(route.execution));
    assert.ok([null, "shared_modifier"].includes(route.damageModifier));
    assert.ok([null, "shared_modifier"].includes(route.battleStatModifier));
    assert.ok(["supported", "partial", "manual"].includes(route.parserStatus));
    assert.ok(route.phases.length > 0);
    assert.ok(Object.isFrozen(route));
    assert.ok(Object.isFrozen(route.phases));
  }
  assert.equal(cardRuntimeRoute("R-JUNKY"), null);
  assert.equal(cardRuntimeRoute("T-BUG-TOKEN"), null);
});

test("keyword-only and vanilla cards use the shared intrinsic route", () => {
  const ids = Object.values(CARD_RUNTIME_ROUTES).filter((route) => route.execution === "shared_intrinsic").map((route) => route.id).sort();
  assert.deepEqual(ids, ["STD-020", "STD-021", "STD-022", "STD-023", "STD-024", "STD-025", "STD-026", "STD-027", "STD-028", "STD-029", "STD-043", "STD-044", "STD-050", "STD-076", "STD-092", "STD-129", "STD-132", "STD-161", "STD-189", "SZTB-090", "SZTB-091"]);
});

test("card runtime registry routes only the declared phase", () => {
  for (const [id, entry] of Object.entries(CARD_RUNTIME_SPECS)) {
    assert.ok(Object.isFrozen(entry));
    for (const spec of phaseSpecs(entry)) {
      assert.equal(cardRuntimeSpec(id, spec.phase), spec);
      assert.ok(Object.isFrozen(spec));
      assert.ok(Object.isFrozen(spec.actions));
    }
    assert.equal(cardRuntimeSpec(id, "__undeclared__"), null);
    if (entry.phases) assert.ok(Object.isFrozen(entry.phases));
  }
  assert.equal(cardRuntimeSpec("STD-000", "spell"), null);
});

test("card runtime specs use only the shared operation vocabulary", () => {
  const known = new Set(Object.values(EFFECT_OPERATION_TYPES));
  const assertKnownAction = (id, action) => {
    assert.ok(known.has(action.type), `${id} uses unknown operation ${action.type}`);
    for (const nested of action.afterActions ?? []) assertKnownAction(id, nested);
  };
  for (const [id, entry] of Object.entries(CARD_RUNTIME_SPECS)) {
    for (const spec of phaseSpecs(entry)) {
      assert.ok(spec.actions.length > 0, `${id}:${spec.phase} must declare at least one action`);
      for (const action of spec.actions) assertKnownAction(id, action);
    }
  }
});

test("unspecified selection scope defaults to both players' whole area", () => {
  assert.deepEqual(selector(), { owner: "both", zones: ["area"], category: null, count: 1, visibility: "public" });
});

test("damage modifiers use one shared declarative registry", () => {
  assert.deepEqual(Object.keys(CARD_DAMAGE_MODIFIER_SPECS).sort(), ["STD-039", "STD-041", "STD-087", "STD-127", "STD-205"]);
  for (const [id, specs] of Object.entries(CARD_DAMAGE_MODIFIER_SPECS)) {
    assert.ok(CARD_LIBRARY[id]);
    assert.ok(Object.isFrozen(specs));
    for (const item of specs) {
      assert.equal(item.type, "modify_damage");
      assert.equal(item.providerScope, "own_area");
      assert.ok(["add", "cap_max", "set"].includes(item.operation));
      assert.ok(["dealt", "received"].includes(item.direction));
      assert.ok(Object.isFrozen(item));
    }
    assert.equal(damageModifierSpecsFor(id), specs);
    assert.equal(cardRuntimeRoute(id).damageModifier, "shared_modifier");
  }
  assert.deepEqual(damageModifierSpecsFor("STD-000"), []);
});

test("battle stat modifiers use one shared declarative registry", () => {
  assert.deepEqual(Object.keys(CARD_BATTLE_STAT_MODIFIER_SPECS), ["STD-130"]);
  const specs = battleStatModifierSpecsFor("STD-130");
  assert.equal(specs.length, 1);
  assert.equal(specs[0].stat, "str");
  assert.equal(specs[0].operation, "add");
  assert.equal(specs[0].value.expression, "own_area_filter_count");
  assert.equal(cardRuntimeRoute("STD-130").battleStatModifier, "shared_modifier");
  assert.deepEqual(battleStatModifierSpecsFor("STD-000"), []);
});

test("continuous effects use shared stat, keyword and mandatory-check registries", () => {
  assert.deepEqual(Object.keys(CARD_CONTINUOUS_STAT_MODIFIER_SPECS), ["STD-109"]);
  assert.deepEqual(Object.keys(CARD_CONDITIONAL_KEYWORD_SPECS), ["STD-123"]);
  assert.deepEqual(Object.keys(CARD_MANDATORY_STATE_CHECK_SPECS), ["STD-084", "STD-123"]);
  assert.deepEqual(Object.keys(CARD_PLAYER_VALUE_MODIFIER_SPECS), ["STD-004", "STD-005"]);
  assert.deepEqual(Object.keys(CARD_EXECUTION_COST_MODIFIER_SPECS), ["STD-100", "STD-007", "STD-008"]);
  assert.deepEqual(Object.keys(CARD_MOUNTED_STAT_MODIFIER_SPECS), ["STD-078", "STD-079", "STD-080"]);
  assert.deepEqual(Object.keys(CARD_MOUNTED_KEYWORD_SPECS), ["STD-079", "STD-080"]);
  assert.deepEqual(Object.keys(CARD_MOUNT_EVENT_SPECS), ["STD-016", "STD-017", "STD-234", "STD-235"]);
  assert.deepEqual(Object.keys(CARD_AURA_KEYWORD_SPECS), ["STD-115", "STD-117"]);
  assert.deepEqual(Object.keys(CARD_ATTACK_PERMISSION_SPECS), ["STD-091", "STD-181", "STD-220"]);
  assert.deepEqual(Object.keys(CARD_DESTRUCTION_PERMISSION_SPECS), ["STD-159"]);
  assert.deepEqual(Object.keys(CARD_PLACEMENT_PERMISSION_SPECS), ["STD-088", "STD-193", "STD-201", "STD-228"]);
  assert.equal(continuousStatModifierSpecsFor("STD-109")[0].condition.expression, "source_has_any_keyword");
  assert.deepEqual(conditionalKeywordSpecsFor("STD-123")[0].keywords, ["QA", "HACKING"]);
  assert.equal(mandatoryStateCheckSpecsFor("STD-084")[0].condition.expression, "source_is_not_mounted");
  assert.equal(mandatoryStateCheckSpecsFor("STD-123")[0].suppressReplacement, true);
  assert.deepEqual(continuousStatModifierSpecsFor("STD-000"), []);
});

test("partial batch contracts expose canonical parser and shared destruction metadata", () => {
  for (const id of ["STD-048", "STD-086", "STD-124", "STD-142", "STD-159"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(typeof compiled.status, "string", id);
    assert.ok(Array.isArray(compiled.clauses), id);
  }
  const parsed = compileEffectText(CARD_LIBRARY["STD-048"].text, { id: "STD-048", category: CARD_LIBRARY["STD-048"].category });
  assert.ok(parsed.clauses.flatMap((clause) => clause.triggers).some((trigger) => trigger.type === "mandatory_rule_draw"));
  assert.ok(parsed.operations.some((operation) => operation.type === "drag"));

  const luckyShot = cardRuntimeSpec("STD-086", "spell");
  const optionalDestroy = luckyShot.actions.find((action) => action.type === "select")?.afterActions?.find((action) => action.type === "destroy");
  assert.equal(optionalDestroy?.recordAs, "destroyed_count");
  assert.equal(optionalDestroy?.suppressReplacement, undefined);

  const corpseTrigger = specsForEvent("card_destroyed").find((spec) => spec.cardId === "STD-159");
  assert.ok(corpseTrigger.conditions.some((condition) => condition.type === "source_face_up"));
  assert.ok(corpseTrigger.conditions.some((condition) => condition.type === "event_card_category" && condition.category === "Ob"));
});

test("if Script resident bodies are reusable optional trigger action specs", () => {
  const std139 = optionalSpecsForCard("STD-139");
  const std140 = optionalSpecsForCard("STD-140");
  assert.equal(std139.length, 1);
  assert.equal(std140.length, 1);
  assert.equal(std139[0].actions[0].selector, "one_own_ob");
  assert.equal(std139[0].actions[0].then, "modify_and_grant");
  assert.equal(std140[0].actions[0].then, "modify_and_prevent_battle_damage");
});

test("STD-148 exposes one opponent-turn optional activation adapter", () => {
  const specs = optionalSpecsForCard("STD-148");
  assert.equal(specs.length, 1);
  assert.equal(specs[0].event, "turn_started");
  assert.ok(specs[0].conditions.some((condition) => condition.type === "source_face_down"));
  assert.ok(specs[0].conditions.some((condition) => condition.type === "event_player_is_enemy"));
  assert.equal(SHARED_TRIGGER_CARD_IDS.includes("STD-148"), true);
  assert.equal(CARD_LIBRARY["STD-148"].text.includes("[if:相手ターン開始時]"), true);
});

test("STD-121 declares one all-required placement destruction cost over both face-up areas", () => {
  const runtime = cardPlacementCostSpec("STD-121");
  assert.equal(CARD_PLACEMENT_COST_SPECS["STD-121"], runtime);
  assert.equal(cardPlacementCostSpec("STD-000"), null);
  assert.deepEqual(runtime.selection.zones, ["front", "back"]);
  assert.equal(runtime.selection.controller, "any");
  assert.equal(runtime.selection.faceUp, true);
  assert.equal(runtime.selection.namePrefix, "情報管理端末");
  assert.equal(runtime.selection.count, 3);
  assert.equal(runtime.selection.distinctBy, "name");
  assert.equal(runtime.payment.operation, "destroy");
  assert.equal(runtime.payment.allRequired, true);

  const compiled = compileEffectText(CARD_LIBRARY["STD-121"].text, { id: "STD-121", category: CARD_LIBRARY["STD-121"].category });
  const trinity = compiled.operations.find((operation) => operation.type === "trinity_resident");
  assert.deepEqual(trinity.executionCost, {
    operation: "destroy", zones: ["front", "back"], controller: "any", faceUp: true,
    namePrefix: "情報管理端末", count: 3, distinctBy: "name", allRequired: true
  });
});
