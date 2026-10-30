// STD-194 マーダードールズ=アクロィア
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-194",
  "name": "マーダードールズ=アクロィア",
  "category": "Ob",
  "color": "紫",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [
    "マスターピース"
  ],
  "text": "これが移動した時+1/+1し、元のエリアに『ドールズ』1体を生成し配置する。",
  "sourceId": "STD-194",
  "printedCategory": "Ob",
  "cardClass": "マスターピース"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-194:self-moved",
    cardId: "STD-194",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [
      op("modify_stats", { target: "source", atk: 1, str: 1, duration: "game" }),
      op("generate", { cardId: "STD-189", count: 1, destination: "event_from_zone" })
    ]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
