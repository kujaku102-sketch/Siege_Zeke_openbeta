// STD-001 マテリアル・スナイプ
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-001",
  "name": "マテリアル・スナイプ",
  "category": "Script",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "[条件:相手がカードを配置した時]Ob以外のカード1枚を破壊する。"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-001:enemy-card-placed", cardId: "STD-001", event: "card_placed", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }],
    actions: [op("select", { selector: "one_non_ob", controller: "any", then: "destroy" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
