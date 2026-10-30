// STD-002 シャットアウト・プログラム
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-002",
  "name": "シャットアウト・プログラム",
  "category": "Script",
  "color": null,
  "cost": 3,
  "classes": [],
  "text": "[条件:攻撃によるダメージを受けた時]相手エリアのOb以外のカードすべてを破壊する。"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-002:attack-damage", cardId: "STD-002", event: "user_damaged", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_source_controller" }, { type: "event_damage_kind", kind: "attack" }],
    actions: [op("destroy_all", { target: "enemy_non_ob" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
