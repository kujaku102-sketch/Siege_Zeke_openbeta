// STD-175 ピューパ・ゼクター
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-175",
  "name": "ピューパ・ゼクター",
  "category": "Ob",
  "color": "緑",
  "cost": 3,
  "atk": 2,
  "str": 3,
  "classes": [],
  "text": "[セキュリティ]インセクトが破壊された時、ゴミ箱からScriptをサルベージする。",
  "traits": [
    "インセクト"
  ]
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
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
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "insect_destroyed_salvage", trigger: "any_insect_destroyed", source: "own_trash", category: "Script", count: 1, keyword: "Security" };
