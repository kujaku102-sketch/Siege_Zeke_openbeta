// STD-171 冒涜の聖母像
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-171",
  "name": "冒涜の聖母像",
  "category": "VOb",
  "color": "黒",
  "cost": 5,
  "atk": 1,
  "str": 5,
  "classes": [],
  "text": "[切断]カードが破壊される度、これの所持ユーザーはカードを1枚引く。"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-171:card-destroyed",
    cardId: "STD-171",
    event: "card_destroyed",
    conditions: [],
    actions: [op("draw", { target: "source_controller", amount: 1 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
