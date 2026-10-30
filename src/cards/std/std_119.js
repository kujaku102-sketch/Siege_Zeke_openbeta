// STD-119 情報管理端末Ⅱ型ソドム
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-119",
  "name": "情報管理端末Ⅱ型ソドム",
  "category": "Script",
  "printedCategory": "Sc",
  "color": "青",
  "cost": 3,
  "classes": [],
  "text": "[レジデント]各ターン1度、「/」で始まり「/*」で終わるSpを起動した時、相手エリアのObすべてに[負荷]を1与える。",
  "sourceId": "STD-119",
  "atk": null,
  "str": null,
  "cardClass": null
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-119:own-slash-sp-executed", cardId: "STD-119", event: "card_executed", limit: "once_per_turn",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_category", category: "Sp" },
      { type: "event_card_name_pattern", pattern: "slash_spell" }
    ],
    actions: [op("add_counter", { target: "enemy_ob_all", counter: "load", amount: 1 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_once_per_turn_spell_trigger", spellNamePattern: "slash_wrapped", action: { type: "add_counter_group", target: "enemy_area_ob", counter: "Load", value: 1 } };
