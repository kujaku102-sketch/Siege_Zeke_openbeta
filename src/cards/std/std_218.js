// STD-218 死の商人
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-218",
  "name": "死の商人",
  "category": "Ob",
  "color": "橙",
  "cost": 5,
  "atk": 5,
  "str": 5,
  "classes": [],
  "text": "いずれかのユーザーのレジストリからカードが離れるたび、自分のメモリを1回復。(上限以上に回復しない。)"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-218:registry-left", cardId: "STD-218", event: "registry_left",
    conditions: [],
    actions: [op("recover_memory", { target: "source_controller", amount: 1 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
