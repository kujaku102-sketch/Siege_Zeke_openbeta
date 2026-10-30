// STD-159 死ねない男 ジーク
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-159",
  "name": "死ねない男 ジーク",
  "category": "Ob",
  "color": "黒",
  "cost": 5,
  "atk": 1,
  "str": 1,
  "classes": [
    "イモータルス"
  ],
  "text": "このObは破壊できない。Obが破壊されるたび、このターン中+1/0する。"
};

// destructionPermissionSpec (was continuous-effect-specs.js)
export const destructionPermissionSpec = [{ type: "forbid_destruction", target: "source" }];

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-159:ob-destroyed",
    cardId: "STD-159",
    event: "card_destroyed",
    conditions: [{ type: "source_face_up" }, { type: "event_card_category", category: "Ob" }],
    actions: [op("modify_stats", { target: "source", atk: 1, str: 0, duration: "turn" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
