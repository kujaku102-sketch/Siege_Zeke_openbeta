import { operation } from "./effect-operation-library.js";
import { CARD_LIBRARY } from "../data/cards.js";
import { compileEffectText } from "./effect-compiler.js";
import { CARD_DAMAGE_MODIFIER_SPECS } from "./damage-modifier-specs.js";
import {
  CARD_CONDITIONAL_KEYWORD_SPECS,
  CARD_CONTINUOUS_STAT_MODIFIER_SPECS,
  CARD_ATTACK_PERMISSION_SPECS,
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
import { SHARED_SELECTION_MODULE_CARD_IDS } from "./effect-selection-modules.js";

const op = (type, options = {}) => operation(type, options);
const spec = (phase, actions, options = {}) => Object.freeze({ phase, actions: Object.freeze(actions), ...options });
const multiSpec = (...specs) => Object.freeze({
  phases: Object.freeze(Object.fromEntries(specs.map((item) => [item.phase, item])))
});

export const CARD_PLACEMENT_COST_SPECS = Object.freeze({
  "STD-121": Object.freeze({
    selection: Object.freeze({
      zones: Object.freeze(["front", "back"]), controller: "any", faceUp: true,
      namePrefix: "情報管理端末", count: 3, distinctBy: "name"
    }),
    payment: Object.freeze({ operation: "destroy", allRequired: true })
  })
});

const armsBandBootCampActions = () => [op("select", {
  selector: { owner: "self", zones: ["trash"], family: "arms_band" },
  count: 1,
  label: "サルベージするアームズバンド・カードを選択",
  afterActions: [
    op("move", { target: "selected_cards", source: "trash", destination: "hand" }),
    op("select", {
      selector: { owner: "self", zones: ["layers"] },
      mode: "up_to", minimum: 0, maximum: "all",
      label: "消費する自分のレイヤーを任意選択",
      skipAfterActionsWhenEmpty: true,
      afterActions: [
        op("consume_layers", { target: "selected_cards", recordAs: "consumed_layers" }),
        op("repeat_select_move", {
          selector: { owner: "self", zones: ["trash"], family: "arms_band" },
          source: "trash", destination: "hand",
          count: { expression: "recorded_count_divided_floor", key: "consumed_layers", divisor: 2 },
          label: "追加でサルベージするアームズバンド・カードを選択"
        })
      ]
    })
  ]
})];

// ID is used only at this registry boundary. The engine executes the same operation
// vocabulary for every registered card and does not own card-specific effect bodies.
export const CARD_RUNTIME_SPECS = Object.freeze({
  "STD-018": spec("script_activation", [
    op("destroy", { target: "activation_target" }),
    op("recover_damage", { target: "enemy_user", amount: 3 })
  ]),
  "STD-019": spec("script_activation", [
    op("destroy", { target: "activation_target" })
  ], {
    additionalCost: {
      type: "discard", source: "hand", count: 1,
      matchEventField: "color", label: "追加コストとして捨てる同色カードを選択"
    }
  }),
  "STD-031": spec("attack_declared", [op("select", {
    selector: { owner: "enemy", zones: ["area"], category: "Ob" }, count: 1,
    label: "攻撃時効果で破壊する相手Obを選択",
    afterActions: [op("destroy", { target: "selected_enemy_area_card" })]
  })], { settleMissingTargetAsCompleted: true }),
  "STD-036": spec("script_activation", [op("draw", { target: "source_controller", amount: 2 })]),
  "STD-037": spec("script_activation", [op("consume_memory", { target: "enemy_player", amount: 5 })]),
  "STD-038": spec("script_activation", [op("move_event_cards", { destination: "ban" })]),
  "STD-135": spec("logout", [op("schedule_delayed", {
    event: "turn_ended", timing: "current_turn_end", action: "move_source_from_trash",
    destination: "front", resetDamage: true, standby: true
  })]),
  "STD-154": spec("area_to_trash", [op("schedule_delayed", {
    event: "turn_started", timing: "next_controller_turn", action: "move_source_from_trash",
    destination: "choose_area", resetDamage: true, sleep: true
  })]),
  "STD-176": spec("script_activation", [op("grant_keyword", {
    target: "own_ob_all", keyword: "SLASH", duration: "through_next_turn_end"
  })]),
  "STD-186": spec("script_activation", [op("draw", { target: "source_controller", amount: 1 })]),
  "STD-005": spec("turn_end", [op("deal_damage", { target: "self_user", amount: 2 })]),
  "STD-006": multiSpec(
    spec("turn_start", [op("draw", { target: "source_controller", amount: 1 })]),
    spec("turn_end", [op("deal_damage", {
      target: "self_user", amount: 2,
      condition: { expression: "source_controller_memory_equals", amount: 0 }
    })])
  ),
  "STD-075": spec("turn_end", [op("destroy", {
    target: "source",
    condition: { expression: "source_attacked_this_turn" }
  })]),
  "STD-041": spec("logout", [op("decode", {
    filter: { category: "Ob" }, mode: "up_to", minimum: 0, maximum: 2,
    totalOriginalMemoryMaximum: 2, destination: "choose_area"
  })]),
  "STD-082": spec("login", [
    op("mill", { target: "own_deck_top", amount: 1, destination: "trash" }),
    op("decode", { filter: { category: "Code", originalMemoryMaximum: 3 }, count: 1, destination: "choose_area" })
  ]),
  "STD-114": spec("attack_declared", [op("select", {
    selector: { owner: "self", zones: ["area"], category: "Ob", excludeSource: true }, count: 1,
    label: "[ハッキング]を与える他の自分Obを選択",
    afterActions: [op("grant_keyword", { target: "selected_own_ob", keyword: "HACKING", duration: "game" })]
  })]),
  "STD-117": spec("attack_declared", [op("select", {
    selector: {
      owner: "self", zones: ["trash"],
      anyOf: [{ category: "Sp" }, { className: "エレクトロンフェアリー" }]
    },
    count: 1, label: "攻撃時にサルベージするカードを選択",
    afterActions: [op("move", { target: "selected_cards", source: "trash", destination: "hand" })]
  })]),
  "SZTB-092": spec("attack_declared", [op("deal_damage", { target: "attack_target", amount: 3 })]),
  "SZTB-093": spec("attacked", [
    op("deal_damage", { target: "attack_target", amount: 2 }),
    op("generate", { cardId: "SZTB-091", count: 1, destination: "choose_area" })
  ]),
  "SZTB-096": spec("spell", [op("deal_damage", { target: "selected_enemy_ob", amount: 5 })]),
  "SZTB-099": spec("spell", [op("draw", { target: "source_controller", amount: 2 })]),
  "SZTB-102": multiSpec(
    spec("script_activation", armsBandBootCampActions()),
    spec("update", armsBandBootCampActions(), { requiresResidentActive: true })
  ),
  "STD-010": spec("spell", [
    op("discard", { target: "own_hand_all", recordAs: "discarded_count" }),
    op("draw", { target: "source_controller", amount: { expression: "recorded_count", key: "discarded_count" } })
  ]),
  "STD-009": spec("update", [op("modify_stats", {
    target: "own_ob_all", atk: 1, str: 0, duration: "turn"
  })]),
  "STD-011": spec("spell", [op("remove_components", { target: "selected_user_or_card" })]),
  "STD-012": spec("spell", [op("select_player", {
    filter: { trashNonEmpty: true }, recordAs: "selected_player",
    afterActions: [op("move_all", {
      source: "recorded_player_trash", destination: "recorded_player_deck", playerRecord: "selected_player", shuffleAfter: true, excludeSource: true
    })]
  })]),
  "STD-013": spec("spell", [op("access", {
    referenceSelection: { source: "own_hand", field: "classes", reveal: true },
    filter: { sharesFieldWithReference: "classes" }, count: 1, destination: "hand"
  })]),
  "STD-014": spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 3, recordAs: "damage_result" }),
    op("draw", { target: "source_controller", amount: 1, condition: { expression: "recorded_damage_destroyed", key: "damage_result" } })
  ]),
  "STD-015": spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 2, optionalTarget: true }),
    op("deal_damage", { target: "enemy_user", amount: 1 })
  ]),
  "STD-032": spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 3 }),
    op("deal_damage", { target: "selected_enemy_ob", amount: 3, condition: { expression: "selected_target_is_sleeping_ob" } })
  ]),
  "STD-033": spec("spell", [
    op("destroy", { target: "selected_enemy_area_card" }),
    op("deal_damage", { target: "enemy_user", amount: 2 })
  ]),
  "STD-034": spec("spell", [op("deal_damage", { target: "selected_enemy_ob", amount: 6 })]),
  "STD-035": spec("spell", [op("access", {
    filter: { category: "Ob", className: "連合軍" }, count: 2, destination: "hand",
    afterActions: [op("modify_stats", { target: "own_class_ob_all", className: "連合軍", atk: 1, str: 0, duration: "turn" })]
  })]),
  "STD-086": spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 3 }),
    op("select", {
      selector: { owner: "self", zones: ["area"] }, mode: "up_to", minimum: 0, maximum: 1,
      label: "追加効果：自分エリアのカード1枚を破壊すると、相手ユーザーに2ダメージ",
      skipAfterActionsWhenEmpty: true,
      afterActions: [
        op("destroy", { target: "selected_own_area_card", recordAs: "destroyed_count" }),
        op("deal_damage", {
          target: "enemy_user", amount: 2,
          condition: { expression: "recorded_count_positive", key: "destroyed_count" }
        })
      ]
    })
  ]),
  "STD-047": spec("spell", [op("access", {
    filter: { category: "Ob", className: "フィクサー" }, count: 1, destination: "hand"
  })]),
  "STD-110": spec("spell", [op("grant_keyword", { target: "own_ob_all", keyword: "ENCRYPTION", duration: "through_next_turn_end" })]),
  "STD-116": spec("spell", [
    op("grant_keyword", { target: "own_class_ob_all", className: "エレクトロンフェアリー", keyword: "HACKING", duration: "turn" }),
    op("set_flag", { target: "own_class_ob_all", className: "エレクトロンフェアリー", flag: "assaultProgramTurn", value: { expression: "turn_number" } })
  ]),
  "STD-111": spec("spell", [
    op("modify_stats", { target: "selected_own_ob", atk: 1, str: 0, duration: "turn" }),
    op("grant_keyword", { target: "selected_own_ob", keyword: "HACKING", duration: "turn" })
  ]),
  "STD-138": spec("spell", [op("deal_damage", { target: "selected_enemy_ob", amount: { expression: "own_area_security_count_plus_one" } })]),
  "STD-143": spec("spell", [
    op("sleep", { target: "enemy_ob_all" }),
    op("draw", { target: "source_controller", amount: 2, condition: { expression: "opponent_turn" } })
  ]),
  "STD-149": spec("spell", [
    op("recover_damage", { target: "self_user", amount: 2 }),
    op("draw", { target: "source_controller", amount: 1 })
  ]),
  "STD-166": spec("spell", [op("add_counter", {
    target: "enemy_user", counter: "madness", amount: 1,
    condition: { expression: "own_area_has_class_ob", className: "旧支配者" }
  })]),
  "STD-206": spec("spell", [op("generate", { cardIds: ["STD-189", "STD-205"], destination: "hand" })]),
  "STD-202": spec("spell", [
    op("move", {
      target: "activation_target", owner: "enemy", source: "front", destination: "back",
      controllerRecord: "moved_controller", sourceZoneRecord: "original_zone"
    }),
    op("generate", {
      cardId: "STD-189", count: 1, destination: { expression: "recorded_value", key: "original_zone" },
      playerRecord: "moved_controller"
    })
  ]),
  "STD-209": spec("spell", [
    op("destroy", {
      target: "activation_target", owner: "enemy", zones: ["area"],
      recordAs: "destroyed_count", recordCategoryAs: "destroyed_category"
    }),
    op("generate", {
      cardIds: ["STD-205", "STD-189"], destination: "hand",
      condition: { expression: "recorded_value_equals", key: "destroyed_category", value: "Ob" }
    }),
    op("generate", {
      cardIds: ["STD-189", "STD-189"], destination: "hand",
      condition: { expression: "recorded_value_not_equals", key: "destroyed_category", value: "Ob", requiresKey: true }
    })
  ]),
  "STD-222": spec("spell", [
    op("move_all", { source: "own_hand", destination: "registry", recordAs: "moved_count" }),
    op("draw", { target: "source_controller", amount: { expression: "recorded_count", key: "moved_count" } })
  ]),
  "STD-233": spec("spell", [op("generate", { cardIds: ["STD-234", "STD-235"], destination: "hand" })]),

  "STD-040": spec("login", [op("access", {
    filter: { category: "Ob", effectText: "none" }, count: 1, destination: "drag", enterSleep: true
  })]),
  "STD-030": spec("login", [op("select", {
    selector: { owner: "enemy", zones: ["area"], category: "Ob", effectTargeting: true },
    count: 1,
    continueWhenEmpty: true,
    label: "3ダメージを与える相手Obを選択",
    afterActions: [
      op("deal_damage", { target: "selected_enemy_ob", amount: 3 }),
      op("deal_damage", { target: "enemy_user", amount: 3 })
    ]
  })]),
  "STD-042": spec("login", [op("access", {
    filter: { category: "Ob", effectText: "none" }, count: 2, destination: "hand"
  })]),
  "STD-045": spec("login", [op("access", {
    filter: { category: "Ob", effectText: "none" }, count: 1, destination: "drag", enterSleep: false
  })]),
  "STD-046": spec("login", [
    op("mill", { target: "own_deck_top", amount: 3, destination: "trash", recordAs: "milled_ob_to_trash", recordFilter: { category: "Ob" } }),
    op("modify_stats", { target: "source", atk: 1, str: 1, multiplier: { expression: "recorded_count", key: "milled_ob_to_trash" }, duration: "game",
      condition: { expression: "recorded_count_positive", key: "milled_ob_to_trash" } })
  ]),
  "STD-077": spec("login", [op("select", {
    selector: { owner: "self", zones: ["hand"], className: "レッドパンクス" },
    count: 1,
    condition: { expression: "source_is_mounted" },
    afterActions: [
      op("discard", { target: "selected_cards", recordAs: "discarded_count" }),
      op("draw", {
        target: "source_controller", amount: 2,
        condition: { expression: "recorded_count_positive", key: "discarded_count" }
      })
    ]
  })]),
  "STD-081": spec("login", [op("access", {
    filter: { category: "Code", originalMemoryMaximum: 2 }, mode: "up_to", minimum: 0, maximum: "all",
    totalOriginalMemoryMaximum: 2, destination: "drag", enterSleep: false
  })]),
  "STD-083": spec("login", [op("access", {
    filter: { category: "Lyd-Ob", className: "レッドパンクス" }, mode: "up_to", minimum: 1, maximum: 2,
    destination: "distribute", destinations: ["hand", "trash"], condition: { expression: "source_is_mounted" }
  })]),
  "STD-087": spec("login", [op("access", {
    filter: { categories: ["Ob", "Code"], originalMemoryMaximum: 1 }, count: 1, destination: "drag", enterSleep: false
  })]),
  "STD-089": spec("login", [op("modify_stats", {
    target: "own_mounted_ob_all", atk: 1, str: 0, perTargetMultiplier: "layer_count", duration: "turn"
  })]),
  "STD-090": spec("login", [op("access", {
    filter: { name: "ジャンクパーツ" }, count: 1, destination: "drag", enterSleep: false
  })]),
  "STD-091": spec("login", [op("set_flag", { target: "source", flag: "mustAttackObTurn", value: { expression: "turn_number" } })]),
  "STD-093": spec("login", [op("generate", { factory: "punks_token", count: 1, destination: "choose_area" })]),
  "STD-094": spec("login", [op("deal_damage", { target: "enemy_user", amount: { expression: "source_stack_count" } })]),
  "STD-098": spec("login", [
    op("modify_stats", { target: "source", atk: 2, str: 0, multiplier: { expression: "source_lyd_layer_count" }, duration: "game" }),
    op("grant_keyword", { target: "source", keyword: "QA", condition: { expression: "source_has_lyd_layer" }, duration: "game" })
  ]),
  "STD-099": spec("login", [op("modify_stats", { target: "source", atk: 1, str: 1, multiplier: { expression: "source_layer_count" }, duration: "game" })]),
  "STD-205": spec("login", [op("modify_stats", { target: "source", atk: 1, str: 1, multiplier: { expression: "source_layer_count" }, duration: "game" })]),
  "STD-101": spec("login", [op("access", {
    filter: { name: "ジャンクエンジン" }, count: 1, destination: "drag", enterSleep: false
  })]),
  "STD-103": spec("login", [op("select", {
    selector: { owner: "self", zones: ["area"], printedCategory: "Lyd-Ob" }, count: 1, recordAs: "layer_host",
    afterActions: [op("select", {
      selector: { owner: "self", zones: ["trash"], correspondsToRecordedHost: "layer_host" }, count: 1,
      afterActions: [op("move", {
        target: "selected_cards", source: "trash", destination: "bottom_layer_of_recorded_host", hostRecord: "layer_host"
      })]
    })]
  })]),
  "STD-107": spec("login", [op("access", {
    filter: { category: "Sp", nameStartsWith: "/", nameEndsWith: "/*" }, count: 1, destination: "hand"
  })]),
  "STD-108": spec("login", [op("access", {
    filter: { className: "エレクトロンフェアリー" }, count: 1, destination: "hand"
  })]),
  "STD-113": multiSpec(
    spec("login", [op("select", {
      selector: { owner: "self", zones: ["hand"], category: "Ob", className: "エレクトロンフェアリー", originalMemoryMaximum: 2 },
      count: 1,
      afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "area", free: true, forced: true })]
    })]),
    spec("turn_start", [op("select", {
      selector: { owner: "self", zones: ["hand"], category: "Ob", className: "エレクトロンフェアリー", originalMemoryMaximum: 2 },
      count: 1,
      afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "area", free: true, forced: true })]
    })])
  ),
  "STD-125": spec("login", [
    op("draw", { target: "source_controller", amount: 2, condition: { expression: "source_oc_paid_at_least", amount: 4 } }),
    op("modify_stats", { target: "source", atk: 2, str: 2, duration: "game", condition: { expression: "source_oc_paid_at_least", amount: 4 } })
  ]),
  "STD-137": spec("spell", [op("choose_effect", {
    value: { expression: "absolute_user_str_difference" }, recordAs: "x",
    choices: [
      {
        label: "①自分Obすべてを+2/+2",
        actions: [op("modify_stats", { target: "own_ob_all", atk: 2, str: 2, duration: "through_next_turn" })]
      },
      {
        label: "②ナイツ・オブ・マキナをデコード",
        actions: [op("decode", {
          filter: {
            category: "Ob", className: "ナイツ・オブ・マキナ",
            originalMemoryMaximum: { expression: "recorded_count", key: "x" }
          },
          count: 1
        })]
      }
    ]
  })]),
  "STD-146": spec("spell", [op("decode", {
    filter: {
      category: "Ob",
      originalMemoryMaximumExclusive: {
        expression: "own_trash_filter_union_count",
        filters: [{ className: "ナイツ・オブ・マキナ" }, { keyword: "SECURITY" }]
      }
    },
    count: 1
  })]),
  "STD-128": spec("login", [op("access", {
    filter: { category: "Ob", className: "ナイツ・オブ・マキナ" }, count: 1, destination: "hand",
    afterActions: [op("access", {
      filter: { category: "Ob", color: "黄", originalMemoryMinimum: 6 }, count: 1, destination: "hand",
      condition: { expression: "source_oc_paid_at_least", amount: 2 }
    })]
  })]),
  "STD-131": spec("logout", [op("select", {
    selector: { owner: "self", zones: ["hand"], normalizedName: "華守り" }, count: 1,
    continueWhenEmpty: true, skipAfterActionsWhenEmpty: true,
    afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "drag", free: true, forced: true })]
  })]),
  "STD-126": spec("login", [op("draw", { target: "source_controller", amount: 1, condition: { expression: "another_own_ob_has_security" } })]),
  "STD-133": spec("login", [op("draw", { target: "source_controller", amount: { expression: "own_area_security_count" } })]),
  "STD-134": spec("login", [op("set_flag", { target: "enemy_player", flag: "forceAttack", value: true })]),
  "STD-144": spec("login", [op("increase_memory_limit", {
    target: "source_controller", amount: 1, condition: { expression: "own_user_str_less_than_opponent" }
  })]),
  "STD-145": spec("logout", [op("increase_memory_limit", { target: "source_controller", amount: 1 })]),
  "STD-150": spec("logout", [op("deal_damage", { target: "random_enemy_ob", amount: 1 })]),
  "STD-151": spec("logout", [op("discard", { target: "random_enemy_hand", count: 1 })]),
  "STD-152": multiSpec(
    spec("login", [op("decode", {
      filter: { category: "Ob", originalMemoryMaximum: 2 }, count: 1, destroyAtTurnEnd: true
    })]),
    spec("update", [op("decode", {
      filter: { category: "Ob", originalMemoryMaximum: 2 }, count: 1, destroyAtTurnEnd: true
    })])
  ),
  "STD-153": multiSpec(
    spec("login", [op("select", {
      selector: { owner: "enemy", zones: ["area"], category: "Ob" }, count: 1,
      afterActions: [op("add_counter", { target: "selected_enemy_ob", counter: "load", amount: 2 })]
    })]),
    spec("logout", [op("select", {
      selector: { owner: "enemy", zones: ["area"], category: "Ob" }, count: 1,
      afterActions: [op("add_counter", { target: "selected_enemy_ob", counter: "load", amount: 2 })]
    })])
  ),
  "STD-155": spec("login", [op("select", {
    selector: { owner: "self", zones: ["area"], category: "Ob" },
    mode: "up_to", minimum: 0, maximum: 1, skipAfterActionsWhenEmpty: true,
    label: "破壊する自分Obを0～1体選択",
    afterActions: [
      op("destroy", { target: "selected_own_ob" }),
      op("draw", { target: "source_controller", amount: 2 })
    ]
  })]),
  "STD-156": spec("logout", [op("choose_effect", {
    choices: [
      { label: "①自分ユーザーを3回復", actions: [op("recover_damage", { target: "self_user", amount: 3 })] },
      { label: "②名称の異なるメモリ3以下Obをデコード", actions: [op("decode", {
        filter: { category: "Ob", originalMemoryMaximum: 3, excludeSourceName: true }, count: 1
      })] }
    ]
  })]),
  "STD-158": multiSpec(
    spec("login", [op("access", { filter: { category: "Ob", color: "黒" }, count: 1, destination: "hand" })]),
    spec("turn_start", [op("access", { filter: { category: "Ob", color: "黒" }, count: 1, destination: "hand" })]),
    spec("logout", [op("schedule_delayed", {
      event: "turn_started", timing: "next_controller_turn", action: "move_source_from_trash",
      destination: "hand"
    })])
  ),
  "STD-172": spec("logout", [op("move", {
    target: "random_each_player", source: "hand_and_area", destination: "ban", count: 1
  })]),
  "STD-170": spec("update", [op("generate", {
    cardIds: ["STD-165", "STD-171", "STD-172"], randomOne: true, destination: "execute",
    free: true, forced: true
  })]),
  "STD-173": spec("login", [op("access", {
    filter: { category: "Script", originalSetupMemoryMaximum: 1 }, count: 1, destination: "hand"
  })]),
  "STD-180": spec("login", [op("access", {
    filter: { trait: "インセクト" }, count: 1, destination: "hand"
  })]),
  "STD-182": spec("login", [op("select", {
    selector: { owner: "self", zones: ["hand"], category: "Script", originalSetupMemoryMaximum: 2 },
    count: 1,
    afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "back", free: true, forced: true, asScript: true })]
  })]),
  "STD-188": spec("login", [op("select", {
    selector: { owner: "self", zones: ["front"], category: "Ob", excludeSource: true },
    count: 1,
    afterActions: [
      op("move", { target: "selected_cards", source: "front", destination: "back" }),
      op("generate", { cardId: "STD-189", count: 1, destination: "choose_area" })
    ]
  })]),
  "STD-192": spec("update", [
    op("move", {
      target: "activation_target", source: "area",
      destination: { expression: "recorded_value", key: "activation_target_zone" }
    }),
    op("draw", { target: "source_controller", amount: 1 })
  ]),
  "STD-196": multiSpec(
    spec("login", [op("select", {
      selector: { owner: "self", zones: ["area"], category: "Ob" }, count: 2,
      afterActions: [op("swap", { target: "selected_own_area_cards" })]
    })]),
    spec("update", [op("select", {
      selector: { owner: "self", zones: ["area"], category: "Ob" }, count: 2,
      afterActions: [op("swap", { target: "selected_own_area_cards" })]
    })])
  ),
  "STD-199": spec("login", [op("select", {
    selector: { owner: "both", zones: ["front"], category: "Ob" }, count: 1, recordAs: "move_target",
    afterActions: [op("choose_effect", {
      choices: [
        {
          label: "手札に戻す",
          actions: [
            op("move", { target: "recorded_cards", recordKey: "move_target", source: "front", destination: "hand", beneficiaryRecord: "moved_owner" }),
            op("recover_memory", { target: "recorded_player", playerRecord: "moved_owner", amount: 2 })
          ]
        },
        {
          label: "バックに移動",
          actions: [
            op("move", { target: "recorded_cards", recordKey: "move_target", source: "front", destination: "back", beneficiaryRecord: "moved_owner" }),
            op("draw", { target: "recorded_player", playerRecord: "moved_owner", amount: 1 })
          ]
        }
      ]
    })]
  })]),
  "STD-200": multiSpec(
    spec("login", [op("choose_zone", {
      target: "source", destinations: "other_area", sourceZoneRecord: "original_zone", destinationRecord: "chosen_zone",
      afterActions: [
        op("move", { target: "source", destination: { expression: "recorded_value", key: "chosen_zone" } }),
        op("generate", { cardId: "STD-201", count: 1, destination: { expression: "recorded_value", key: "original_zone" } })
      ]
    })]),
    spec("update", [op("choose_zone", {
      target: "source", destinations: "other_area", sourceZoneRecord: "original_zone", destinationRecord: "chosen_zone",
      afterActions: [
        op("move", { target: "source", destination: { expression: "recorded_value", key: "chosen_zone" } }),
        op("generate", { cardId: "STD-201", count: 1, destination: { expression: "recorded_value", key: "original_zone" } })
      ]
    })])
  ),
  "STD-201": spec("update", [op("destroy", { target: "source", suppressReplacement: true })]),
  "STD-210": multiSpec(
    spec("login", [op("access", {
      filter: { category: "Sp", nameIncludes: "パッチワーク" }, count: 1, destination: "hand", reveal: true,
      afterActions: [op("modify_execution_cost", { target: "selected_cards", amount: -2, duration: "turn" })]
    })]),
    spec("update", [op("access", {
      filter: { category: "Sp", nameIncludes: "パッチワーク" }, count: 1, destination: "hand", reveal: true,
      afterActions: [op("modify_execution_cost", { target: "selected_cards", amount: -2, duration: "turn" })]
    })])
  ),
  "STD-198": spec("login", [op("generate", { cardId: "STD-189", count: 3, destination: "choose_area" })]),
  "STD-213": spec("login", [op("select", {
    selector: { owner: "self", zones: ["hand"] }, count: 1,
    afterActions: [
      op("move", { target: "selected_cards", source: "hand", destination: "registry", faceDown: true }),
      op("draw", { target: "source_controller", amount: 1 })
    ]
  })]),
  "STD-216": spec("login", [op("move", { target: "deck_top", destination: "registry", count: 1 })]),
  "STD-221": spec("login", [op("deal_damage", { target: "enemy_user", amount: { expression: "registry_execution_damage", normal: 1, registry: 3 } })]),
  "STD-225": spec("login", [op("select", {
    selector: { owner: "self", zones: ["registry"] }, mode: "up_to", minimum: 0, maximum: "all", skipAfterActionsWhenEmpty: true,
    afterActions: [
      op("destroy", { target: "selected_own_registry_cards", recordAs: "destroyed_registry_count" }),
      op("recover_memory", { target: "source_controller", amount: { expression: "recorded_count", key: "destroyed_registry_count" } })
    ]
  })]),
  "STD-236": spec("login", [op("select", {
    selector: { owner: "self", zones: ["deck"] }, count: 2,
    afterActions: [
      op("move", { target: "selected_cards", source: "deck", destination: "registry", faceDown: false }),
      op("shuffle", { target: "own_deck" })
    ]
  })])
});

export const CARD_BATTLE_STAT_MODIFIER_SPECS = Object.freeze({
  "STD-130": Object.freeze([Object.freeze({
    stat: "str",
    operation: "add",
    value: Object.freeze({
      expression: "own_area_filter_count",
      filter: Object.freeze({ category: "Ob", className: "ナイツ・オブ・マキナ" })
    }),
    duration: "battle"
  })])
});

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
