// STD-178 ムカデの隊列
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-178",
  "name": "ムカデの隊列",
  "category": "Sc",
  "printedCategory": "Sc",
  "color": "緑",
  "cost": 44199,
  "classes": [],
  "text": "1ターンに1度①を起動できる。①Obが攻撃する時、次のターン終了時まで自分のObすべてを+2/+2して[セキュリティ]を与える。",
  "setupCost": 1,
  "activationCost": 3,
  "printedCost": "1-3",
  "traits": [
    "インセクト"
  ]
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-178:ob-attacks", cardId: "STD-178", event: "attack_declared", activation: "optional", limit: "once_per_turn",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }],
    actions: [op("modify_stats", { target: "own_ob_all", atk: 2, str: 2, keyword: "SECURITY", duration: "through_next_turn" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
