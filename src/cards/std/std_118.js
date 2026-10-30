// STD-118 情報管理端末Ⅰ型バベル
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-118",
  "name": "情報管理端末Ⅰ型バベル",
  "category": "Script",
  "printedCategory": "Sc",
  "color": "青",
  "cost": 3,
  "classes": [],
  "text": "[レジデント]各ターン1度、「/」で始まり「/*」で終わるSpを起動した時、そのSpをゴミ箱に置くかわりに手札に加える。",
  "sourceId": "STD-118",
  "atk": null,
  "str": null,
  "cardClass": null
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-118:own-slash-sp-executed", cardId: "STD-118", event: "card_executed", limit: "once_per_turn",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_category", category: "Sp" },
      { type: "event_card_name_pattern", pattern: "slash_spell" }
    ],
    actions: [op("move_event_card", { source: "trash", destination: "hand" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_replacement", limit: "once_per_turn", trigger: "slash_spell_activated", replacement: "trash_to_hand" };
