// STD-112 観測機用素体F型 ネージュ
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-112",
  "name": "観測機用素体F型 ネージュ",
  "category": "Ob",
  "color": "青",
  "cost": 3,
  "atk": 2,
  "str": 3,
  "classes": [
    "ニュートロン・セキュリティ",
    "エレクトロン・フェアリー"
  ],
  "text": "[暗号化]自分の[ハッキング]を持つObがユーザーに攻撃する時、カードを1枚引く。",
  "sourceId": "STD-112",
  "printedCategory": "Ob"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-112:own-hacking-user-attack", cardId: "STD-112", event: "attack_declared",
    conditions: [
      { type: "event_card_owner_is_source_controller" },
      { type: "event_attacker_has_keyword", keyword: "HACKING" },
      { type: "event_target_is_enemy_fortress" }
    ],
    actions: [op("draw", { target: "source_controller", amount: 1 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
