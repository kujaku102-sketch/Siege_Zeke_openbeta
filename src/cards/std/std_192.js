// STD-192 マーダードールズ=タナフォリア
import { op, spec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-192",
  "name": "マーダードールズ=タナフォリア",
  "category": "Ob",
  "color": "紫",
  "cost": 2,
  "atk": 1,
  "str": 3,
  "classes": [
    "マスターピース"
  ],
  "text": "[アップデート:2]自分Ob1体をフロントまたはバックに移動させる。カードを1枚引く。これが移動した時、相手フロントObすべてに1ダメージ。",
  "sourceId": "STD-192",
  "printedCategory": "Ob",
  "cardClass": "マスターピース"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("update", [
    op("move", {
      target: "activation_target", source: "area",
      destination: { expression: "recorded_value", key: "activation_target_zone" }
    }),
    op("draw", { target: "source_controller", amount: 1 })
  ]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-192:self-moved",
    cardId: "STD-192",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [op("deal_damage", { target: "enemy_front_all", amount: 1 })]
  })
];
