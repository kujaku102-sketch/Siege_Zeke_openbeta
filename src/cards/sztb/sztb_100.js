// SZTB-100 『我ら 特殊部隊銃装重奏』
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "SZTB-100",
  "sourceId": "SZTB100",
  "name": "『我ら 特殊部隊銃装重奏』",
  "category": "Script",
  "printedCategory": "Sc",
  "color": null,
  "cost": 3,
  "text": "[レジデント]各ターン開始時、すべての名称:アームズバンド・レイヤードのレイヤーに『アームズバンド・アマルガム』1枚を生成し加える。",
  "classes": []
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "SZTB-100:each-turn-start", cardId: "SZTB-100", event: "turn_started",
    conditions: [{ type: "source_resident_active" }],
    actions: [op("generate_as_layer_for_each", {
      cardId: "SZTB-090",
      selector: {
        owner: "both",
        zones: ["area"],
        printedCategory: "Lyd-Ob",
        family: "arms_band"
      }
    })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
