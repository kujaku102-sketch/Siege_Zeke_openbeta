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
  "text": "[ログイン]クラス:インセクトOb1枚にアクセスし、それを手札に加える。クラス:インセクトObの配置時、相手Obに2ダメージ。",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Ob", trait: "インセクト" }, count: 1, destination: "hand"
  })]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = ["card_executed", "card_effect_placed"].map((event) => createTriggerSpec({
  // 「配置時」: an Ob placed by execution (card_executed) or by an effect (card_effect_placed); the two never fire for one placement.
  id: `STD-180:insect-${event === "card_executed" ? "executed" : "effect-placed"}`, cardId: "STD-180", event,
  conditions: [{ type: "event_card_owner_is_source_controller" }, { type: "event_card_category", category: "Ob" }, { type: "event_card_trait", trait: "インセクト" }],
  actions: [op("select", { selector: "one_enemy_ob", then: "deal_damage", amount: 2 })]
}));

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
