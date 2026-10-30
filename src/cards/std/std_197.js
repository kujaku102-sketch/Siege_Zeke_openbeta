// STD-197 手品師トリキック
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-197",
  "name": "手品師トリキック",
  "category": "Ob",
  "color": "紫",
  "cost": 3,
  "atk": 2,
  "str": 2,
  "classes": [
    "ヴェンジェンス",
    "アーティスト"
  ],
  "text": "各ターン1度、相手がカードを実行した時、それと同じカテゴリとなるカード1枚にアクセスしそれを手札に加える。その後、『ドールズ』1体を生成し配置する。",
  "sourceId": "STD-197",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/アーティスト"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
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
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
