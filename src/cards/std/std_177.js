// STD-177 甲虫の突撃
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-177",
  "name": "甲虫の突撃",
  "category": "Sc",
  "printedCategory": "Sc",
  "color": "緑",
  "cost": 44197,
  "classes": [],
  "text": "自分のObが戦闘する時、そのObを次のターン終了時まで+2/+2する。",
  "setupCost": 1,
  "activationCost": 1,
  "printedCost": "1-1",
  "traits": [
    "インセクト"
  ]
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-177:own-ob-battle", cardId: "STD-177", event: "battle_started", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }],
    actions: [op("modify_stats", { target: "own_battler", atk: 2, str: 2, duration: "through_next_turn" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
