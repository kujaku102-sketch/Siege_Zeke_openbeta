// STD-208 糸の絡め取り
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-208",
  "name": "糸の絡め取り",
  "category": "Script",
  "color": "紫",
  "cost": 3,
  "classes": [],
  "text": "[レジデント]名称:ドールズのObが破壊される度①を起動する。①相手Ob全てはこのターン-1/0する。",
  "sourceId": "STD-208",
  "printedCategory": "Script",
  "atk": null,
  "str": null,
  "cardClass": null
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-208:dolls-destroyed",
    cardId: "STD-208",
    event: "card_destroyed",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_name", name: "ドールズ" },
      { type: "event_card_category", category: "Ob" }
    ],
    actions: [op("modify_stats", { target: "enemy_ob_all", atk: -1, str: 0, duration: "turn" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
