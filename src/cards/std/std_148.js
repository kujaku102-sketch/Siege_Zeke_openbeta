// STD-148 機械螺子の束
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-148",
  "name": "機械螺子の束",
  "category": "Script",
  "color": "黄",
  "cost": 2,
  "text": "[レジデント][if:相手ターン開始時]相手ターン中、自分Obが戦闘する時相手に1ダメージ。",
  "classes": []
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-148:enemy-turn-start", cardId: "STD-148", event: "turn_started", activation: "optional",
    conditions: [
      { type: "source_zone", zone: "back" },
      { type: "source_face_down" },
      { type: "event_player_is_enemy" }
    ],
    actions: []
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
