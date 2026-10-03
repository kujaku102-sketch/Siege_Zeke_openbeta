// カードテキストから確定した「イベント条件 → アクション列」の宣言的定義。
// 実行コードをカードごとに持たず、共通アクションを組み合わせる。
import { operation } from "./effect-operation-library.js";
import { createTriggerSpec } from "./activation-windows.js";

const op = (type, options) => operation(type, options);
export const TRIGGER_SPECS = Object.freeze([
  createTriggerSpec({
    id: "STD-001:enemy-card-placed", cardId: "STD-001", event: "card_placed", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }],
    actions: [op("select", { selector: "one_non_ob", controller: "any", then: "destroy" })]
  }),
  createTriggerSpec({
    id: "STD-002:attack-damage", cardId: "STD-002", event: "user_damaged", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_source_controller" }, { type: "event_damage_kind", kind: "attack" }],
    actions: [op("destroy_all", { target: "enemy_non_ob" })]
  }),
  createTriggerSpec({
    id: "STD-105:fortress-attacked", cardId: "STD-105", event: "attack_declared", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }, { type: "event_target_is_source_controller_fortress" }],
    actions: []
  }),
  createTriggerSpec({
    id: "STD-139:turn-start", cardId: "STD-139", event: "turn_started", activation: "optional",
    conditions: [{ type: "source_resident_active" }],
    actions: [op("select", { selector: "one_own_ob", then: "modify_and_grant", atk: -2, str: 1, keyword: "SECURITY", duration: "turn" })]
  }),
  createTriggerSpec({
    id: "STD-140:battle", cardId: "STD-140", event: "battle_started", activation: "optional",
    conditions: [{ type: "source_resident_active" }],
    actions: [op("select", { selector: "one_own_ob", then: "modify_and_prevent_battle_damage", atk: -2, str: 0, duration: "turn" })]
  }),
  createTriggerSpec({
    id: "STD-147:user-damaged", cardId: "STD-147", event: "user_damaged", activation: "optional",
    conditions: [{ type: "source_resident_active" }, { type: "event_player_is_source_controller" }],
    actions: [op("recover_memory", { target: "source_controller", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-148:enemy-turn-start", cardId: "STD-148", event: "turn_started", activation: "optional",
    conditions: [
      { type: "source_zone", zone: "back" },
      { type: "source_face_down" },
      { type: "event_player_is_enemy" }
    ],
    actions: []
  }),
  createTriggerSpec({
    id: "STD-177:own-ob-battle", cardId: "STD-177", event: "battle_started", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }],
    actions: [op("modify_stats", { target: "own_battler", atk: 2, str: 2, duration: "through_next_turn" })]
  }),
  createTriggerSpec({
    id: "STD-178:ob-attacks", cardId: "STD-178", event: "attack_declared", activation: "optional", limit: "once_per_turn",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }],
    actions: [op("modify_stats", { target: "own_ob_all", atk: 2, str: 2, keyword: "SECURITY", duration: "through_next_turn" })]
  }),
  createTriggerSpec({
    id: "STD-180:insect-login", cardId: "STD-180", event: "card_executed",
    conditions: [{ type: "event_card_owner_is_source_controller" }, { type: "event_card_trait", trait: "インセクト" }],
    actions: [op("select", { selector: "one_enemy_ob", then: "deal_damage", amount: 2 })]
  }),
  createTriggerSpec({
    id: "STD-134:security-attacked", cardId: "STD-134", event: "attack_declared",
    conditions: [{ type: "event_player_is_enemy" }, { type: "event_target_is_own_security" }],
    actions: [op("deal_damage", { target: "enemy_user", amount: 2 })]
  }),
  createTriggerSpec({
    id: "STD-158:turn-start-access", cardId: "STD-158", event: "turn_started",
    conditions: [{ type: "source_controller_is_event_player" }],
    actions: [op("access", { filter: { category: "Ob", color: "黒" }, count: 1, destination: "hand" })]
  }),
  createTriggerSpec({
    id: "STD-160:own-turn-madness", cardId: "STD-160", event: "turn_started",
    conditions: [{ type: "source_controller_is_event_player" }],
    actions: [op("add_counter", { target: "enemy_user", counter: "madness", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-169:battle-load", cardId: "STD-169", event: "battle_started",
    conditions: [{ type: "source_card_is_battler" }],
    actions: [op("add_counter", { target: "enemy_battler", counter: "load", amount: 2 })]
  }),
  createTriggerSpec({
    id: "STD-159:ob-destroyed",
    cardId: "STD-159",
    event: "card_destroyed",
    conditions: [{ type: "source_face_up" }, { type: "event_card_category", category: "Ob" }],
    actions: [op("modify_stats", { target: "source", atk: 1, str: 0, duration: "turn" })]
  }),
  createTriggerSpec({
    id: "STD-171:card-destroyed",
    cardId: "STD-171",
    event: "card_destroyed",
    conditions: [],
    actions: [op("draw", { target: "source_controller", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-174:script-activated",
    cardId: "STD-174",
    event: "script_activated",
    limit: "once_per_turn",
    conditions: [{ type: "event_card_owner_is_source_controller" }],
    actions: [
      op("modify_stats", { target: "source", atk: 1, str: 0, duration: "game" }),
      op("standby", { target: "source" })
    ]
  }),
  createTriggerSpec({
    id: "STD-176:enemy-turn-start", cardId: "STD-176", event: "turn_started", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }],
    actions: []
  }),
  createTriggerSpec({
    id: "STD-231:enemy-ob-executing", cardId: "STD-231", event: "card_executed", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }, { type: "event_card_category", category: "Ob" }],
    actions: []
  }),
  createTriggerSpec({
    id: "STD-183:own-script-activated",
    cardId: "STD-183",
    event: "script_activated",
    conditions: [{ type: "event_card_owner_is_source_controller" }],
    actions: [op("deal_damage", { target: "enemy_user", amount: 2 })]
  }),
  createTriggerSpec({
    id: "STD-183:insect-effect-placed",
    cardId: "STD-183",
    event: "card_effect_placed",
    conditions: [
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_trait", trait: "インセクト" }
    ],
    actions: [op("deal_damage", { target: "enemy_user", amount: 2 })]
  }),
  createTriggerSpec({
    id: "STD-186:enemy-card-drawn",
    cardId: "STD-186",
    event: "card_drawn",
    activation: "optional",
    conditions: [
      { type: "source_zone", zone: "back" },
      { type: "source_face_down" },
      { type: "event_player_is_enemy" }
    ],
    actions: []
  }),
  createTriggerSpec({
    id: "STD-190:back-turn-end",
    cardId: "STD-190",
    event: "turn_ended",
    conditions: [{ type: "source_zone", zone: "back" }],
    actions: [op("deal_damage", { target: "enemy_user", amount: 2 })]
  }),
  createTriggerSpec({
    id: "STD-191:own-ob-moved",
    cardId: "STD-191",
    event: "card_moved",
    conditions: [{ type: "event_card_owner_is_source_controller" }, { type: "event_card_category", category: "Ob" }],
    actions: [op("recover_memory", { target: "source_controller", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-192:self-moved",
    cardId: "STD-192",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [op("deal_damage", { target: "enemy_front_all", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-193:self-moved",
    cardId: "STD-193",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [op("select", { selector: "one_own_and_one_enemy_ob", optional: true, then: "destroy" })]
  }),
  createTriggerSpec({
    id: "STD-194:self-moved",
    cardId: "STD-194",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [
      op("modify_stats", { target: "source", atk: 1, str: 1, duration: "game" }),
      op("generate", { cardId: "STD-189", count: 1, destination: "event_from_zone" })
    ]
  }),
  createTriggerSpec({
    id: "STD-195:self-moved",
    cardId: "STD-195",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [op("standby", { target: "source" })]
  }),
  createTriggerSpec({
    id: "STD-197:enemy-executed",
    cardId: "STD-197",
    event: "card_executed",
    limit: "once_per_turn",
    conditions: [{ type: "event_player_is_enemy" }],
    actions: [
      op("access", { target: "deck", matchCategory: "event_card", destination: "hand" }),
      op("generate", { cardId: "STD-189", count: 1, destination: "choose_area" })
    ]
  }),
  createTriggerSpec({
    id: "STD-208:dolls-destroyed",
    cardId: "STD-208",
    event: "card_destroyed",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_name", name: "ドールズ" },
      { type: "event_card_category", category: "Ob" }
    ],
    actions: [op("modify_stats", { target: "enemy_ob_all", atk: -1, str: 0, duration: "turn" })]
  }),
  createTriggerSpec({
    id: "STD-164:own-card-destroyed", cardId: "STD-164", event: "card_destroyed",
    conditions: [
      { type: "source_resident_active" },
      { type: "source_controller_is_active_player" },
      { type: "event_card_owner_is_source_controller" }
    ],
    actions: [op("choose_effect", { options: ["discard_enemy_hand", "poison_enemy_ob"] })]
  }),
  createTriggerSpec({
    id: "STD-218:registry-left", cardId: "STD-218", event: "registry_left",
    conditions: [],
    actions: [op("recover_memory", { target: "source_controller", amount: 1 })]
  }),
  createTriggerSpec({
    id: "SZTB-100:each-turn-start", cardId: "SZTB-100", event: "turn_started",
    conditions: [{ type: "source_resident_active" }],
    actions: [op("generate_as_layer_for_each", {
      cardId: "SZTB-090",
      selector: {
        owner: "both",
        zones: ["area"],
        printedCategory: "Lyd-Ob",
        family: "arms_band"
      }
    })]
  }),
  createTriggerSpec({
    id: "SZTB-101:own-layered-login", cardId: "SZTB-101", event: "card_executed",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_family", family: "arms_band" },
      { type: "event_card_printed_category", category: "Lyd-Ob" }
    ],
    actions: [op("generate_as_layer", { cardId: "SZTB-090", target: "event_card" })]
  }),
  createTriggerSpec({
    id: "SZTB-101:own-layered-attack", cardId: "SZTB-101", event: "attack_declared",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_family", family: "arms_band" },
      { type: "event_card_printed_category", category: "Lyd-Ob" }
    ],
    actions: [op("generate_as_layer", { cardId: "SZTB-090", target: "event_card" })]
  }),
  createTriggerSpec({
    id: "STD-232:each-turn-start", cardId: "STD-232", event: "turn_started",
    conditions: [],
    actions: [op("move_each_deck_top_as_layer", { target: "source", owner: "each_player" })]
  }),
  createTriggerSpec({
    id: "STD-112:own-hacking-user-attack", cardId: "STD-112", event: "attack_declared",
    conditions: [
      { type: "event_card_owner_is_source_controller" },
      { type: "event_attacker_has_keyword", keyword: "HACKING" },
      { type: "event_target_is_enemy_fortress" }
    ],
    actions: [op("draw", { target: "source_controller", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-118:own-slash-sp-executed", cardId: "STD-118", event: "card_executed", limit: "once_per_turn",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_category", category: "Sp" },
      { type: "event_card_name_pattern", pattern: "slash_spell" }
    ],
    actions: [op("move_event_card", { source: "trash", destination: "hand" })]
  }),
  createTriggerSpec({
    id: "STD-119:own-slash-sp-executed", cardId: "STD-119", event: "card_executed", limit: "once_per_turn",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_category", category: "Sp" },
      { type: "event_card_name_pattern", pattern: "slash_spell" }
    ],
    actions: [op("add_counter", { target: "enemy_ob_all", counter: "load", amount: 1 })]
  }),
  createTriggerSpec({
    id: "STD-120:own-sp-executed", cardId: "STD-120", event: "card_executed", limit: "once_per_turn",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_category", category: "Sp" }
    ],
    actions: [op("select_execute_from_trash", {
      filter: { category: "Sp", namePattern: "slash_spell", maximumCost: 2 },
      destinationAfterExecution: "deck",
      shuffleAfter: true
    })]
  }),
  createTriggerSpec({
    id: "STD-175:insect-destroyed", cardId: "STD-175", event: "card_destroyed",
    conditions: [
      { type: "event_card_trait", trait: "インセクト" },
      { type: "event_not_rule_destruction" }
    ],
    actions: [op("select", {
      selector: { owner: "self", zones: ["trash"], category: "Script" }, count: 1,
      label: "Scriptをサルベージ",
      afterActions: [op("move", { target: "selected_cards", source: "trash", destination: "hand" })]
    })]
  }),
  createTriggerSpec({
    id: "STD-168:ob-destroyed", cardId: "STD-168", event: "card_destroyed",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_category", category: "Ob" },
      { type: "event_not_rule_destruction" }
    ],
    actions: [op("select_entity", {
      scope: "all_users_and_all_area_ob", count: 1,
      then: op("add_counter", { target: "selected_entity", counter: "load", amount: 1 })
    })]
  })
]);

export const SHARED_TRIGGER_CARD_IDS = Object.freeze([
  "STD-001", "STD-002", "STD-139", "STD-147", "STD-148", "STD-159", "STD-164",
  "STD-171", "STD-174", "STD-177", "STD-178", "STD-180", "STD-183",
  "STD-190", "STD-191", "STD-193", "STD-194", "STD-197", "STD-208", "STD-218",
  "SZTB-100", "SZTB-101", "STD-232", "STD-112", "STD-118", "STD-119", "STD-120", "STD-168", "STD-175"
]);

export function specsForEvent(eventType) {
  return TRIGGER_SPECS.filter((spec) => spec.event === eventType);
}

export function optionalSpecsForCard(cardId) {
  return TRIGGER_SPECS.filter((spec) => spec.cardId === cardId && spec.activation === "optional");
}

export function hasOptionalActivationSpec(cardId) {
  return TRIGGER_SPECS.some((spec) => spec.cardId === cardId && spec.activation === "optional");
}
