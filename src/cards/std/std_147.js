// STD-147 機械螺子の山
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-147",
  "name": "機械螺子の山",
  "category": "Script",
  "color": "黄",
  "cost": 3,
  "classes": [],
  "text": "[レジデント]「if;ダメージを受けた時起動できる」自分がダメージを受けた時、メモリを1回復する。"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-147:user-damaged", cardId: "STD-147", event: "user_damaged", activation: "optional",
    conditions: [{ type: "source_resident_active" }, { type: "event_player_is_source_controller" }],
    actions: [op("recover_memory", { target: "source_controller", amount: 1 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
