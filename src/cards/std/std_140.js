// STD-140 聖樹枝(セフィラリンク)
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-140",
  "name": "聖樹枝(セフィラリンク)",
  "category": "Script",
  "color": "黄",
  "cost": null,
  "classes": [],
  "text": "[レジデント][if:Obの戦闘時]①自分のOb1体はこのターン、-2/0され戦闘でのダメージを受けない。[アップデート:2]①か②を起動する。②『聖樹枝』以外の「聖樹」カード1枚をサルベージする。",
  "setupCost": 2,
  "activationCost": 0,
  "printedCost": "2-0"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-140:battle", cardId: "STD-140", event: "battle_started", activation: "optional",
    conditions: [{ type: "source_resident_active" }],
    actions: [op("select", { selector: "one_own_ob", then: "modify_and_prevent_battle_damage", atk: -2, str: 0, duration: "turn" })]
  })
];
