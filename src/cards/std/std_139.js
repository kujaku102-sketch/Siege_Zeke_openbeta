// STD-139 聖樹枝片(セフィラビット)
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-139",
  "name": "聖樹枝片(セフィラビット)",
  "category": "Script",
  "color": "黄",
  "cost": null,
  "classes": [],
  "text": "[レジデント][if:いずれかのユーザーのターン開始時]①自分のOb1体はこのターン、-2/+1され［セキュリティ］を得る。[アップデート:2]①か②を起動する。②これを破壊し、[レジデント]を持つScript1枚にアクセスしそれを手札に加える。",
  "setupCost": 1,
  "activationCost": 0,
  "printedCost": "1-0"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-139:turn-start", cardId: "STD-139", event: "turn_started", activation: "optional",
    conditions: [{ type: "source_resident_active" }],
    actions: [op("select", { selector: "one_own_ob", then: "modify_and_grant", atk: -2, str: 1, keyword: "SECURITY", duration: "turn" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
