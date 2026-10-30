// STD-193 マーダードールズ=ネクリア
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-193",
  "name": "マーダードールズ=ネクリア",
  "category": "Ob",
  "color": "紫",
  "cost": 3,
  "atk": 5,
  "str": 3,
  "classes": [
    "マスターピース"
  ],
  "text": "[ハッキング]これを実行する時バックにのみ配置できる。これが移動した時、自分と相手のOb1体ずつを選び破壊できる。",
  "sourceId": "STD-193",
  "printedCategory": "Ob",
  "cardClass": "マスターピース"
};

// placementPermissionSpec (was continuous-effect-specs.js)
export const placementPermissionSpec = [{ type: "require_execution_zone", zone: "back" }];

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-193:self-moved",
    cardId: "STD-193",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [op("select", { selector: "one_own_and_one_enemy_ob", optional: true, then: "destroy" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
