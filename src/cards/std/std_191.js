// STD-191 淫魔像
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-191",
  "name": "淫魔像",
  "category": "Ob",
  "color": "紫",
  "cost": 3,
  "atk": 1,
  "str": 1,
  "classes": [
    "マスターピース"
  ],
  "text": "自分のObがエリアを移動した場合、メモリを1回復する。",
  "sourceId": "STD-191",
  "printedCategory": "Ob",
  "cardClass": "マスターピース"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-191:own-ob-moved",
    cardId: "STD-191",
    event: "card_moved",
    conditions: [{ type: "event_card_owner_is_source_controller" }, { type: "event_card_category", category: "Ob" }],
    actions: [op("recover_memory", { target: "source_controller", amount: 1 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
