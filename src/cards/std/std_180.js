// STD-180 コクーン・ゼクター
import { op, spec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-180",
  "name": "コクーン・ゼクター",
  "category": "Ob",
  "color": "緑",
  "cost": 3,
  "atk": 2,
  "str": 4,
  "classes": [],
  "text": "[ログイン]インセクト1枚にアクセスし、それを手札に加える。インセクトのログイン時、相手Obに2ダメージ。",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { trait: "インセクト" }, count: 1, destination: "hand"
  })]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-180:insect-login", cardId: "STD-180", event: "card_executed",
    conditions: [{ type: "event_card_owner_is_source_controller" }, { type: "event_card_trait", trait: "インセクト" }],
    actions: [op("select", { selector: "one_enemy_ob", then: "deal_damage", amount: 2 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
