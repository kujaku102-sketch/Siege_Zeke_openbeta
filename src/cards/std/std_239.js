// STD-239 蜜虫の行進
import { op, spec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-239",
  "name": "蜜虫の行進",
  "category": "Script",
  "color": "緑",
  "cost": null,
  "classes": [],
  "text": "自分ユーザーがダメージを受けた時起動できる。カードを2枚引き、ユーザーのSTRを2回復する。",
  "setupCost": 2,
  "activationCost": 0,
  "printedCost": "2-0",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [
  op("draw", { target: "source_controller", amount: 2 }),
  op("recover_damage", { target: "self_user", amount: 2 })
]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-239:own-user-damaged", cardId: "STD-239", event: "user_damaged", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_source_controller" }],
    actions: []
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
