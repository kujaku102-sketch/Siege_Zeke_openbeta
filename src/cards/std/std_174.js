// STD-174 警戒虫
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-174",
  "name": "警戒虫",
  "category": "Ob",
  "color": "緑",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [],
  "text": "1ターンに1度、Scriptを起動した時に①を起動する。①+1/+0してこのObをスタンバイする。",
  "traits": [
    "インセクト"
  ]
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-174:script-activated",
    cardId: "STD-174",
    event: "script_activated",
    limit: "once_per_turn",
    conditions: [{ type: "event_card_owner_is_source_controller" }],
    actions: [
      op("modify_stats", { target: "source", atk: 1, str: 0, duration: "game" }),
      op("standby", { target: "source" })
    ]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
