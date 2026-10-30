// STD-183 モルフォ・ゼクター
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-183",
  "name": "モルフォ・ゼクター",
  "category": "Ob",
  "color": "緑",
  "cost": 6,
  "atk": 4,
  "str": 6,
  "classes": [],
  "text": "自分のScriptが起動した時またはインセクトが効果で配置された時、相手ユーザーに2ダメージ。",
  "traits": [
    "インセクト"
  ]
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
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
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
