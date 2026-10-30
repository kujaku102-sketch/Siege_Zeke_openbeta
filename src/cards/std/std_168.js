// STD-168 毒の蔓延
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-168",
  "name": "毒の蔓延",
  "category": "Script",
  "color": "黒",
  "cost": 3,
  "text": "[レジデント]Obが破壊されるたび①を起動する。①ユーザーまたはOb1体を選び、それに[負荷]を1つ与える。",
  "classes": []
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-168:ob-destroyed", cardId: "STD-168", event: "card_destroyed",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_category", category: "Ob" },
      { type: "event_not_rule_destruction" }
    ],
    actions: [op("select_entity", {
      scope: "all_users_and_all_area_ob", count: 1,
      then: op("add_counter", { target: "selected_entity", counter: "load", amount: 1 })
    })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_each_ob_destroyed", action: { type: "select_add_counter", target: "any_user_or_ob", counter: "Load", value: 1 } };
