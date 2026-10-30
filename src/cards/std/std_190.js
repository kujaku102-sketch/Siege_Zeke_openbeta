// STD-190 バックハッカー
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-190",
  "name": "バックハッカー",
  "category": "Ob",
  "color": "紫",
  "cost": 3,
  "atk": 2,
  "str": 4,
  "classes": [
    "ニュートロン・セキュリティ",
    "ノイド"
  ],
  "text": "これがバックにいる場合、ターン終了時に相手ユーザーに2ダメージ。",
  "sourceId": "STD-190",
  "printedCategory": "Ob",
  "cardClass": "ニュートロン・セキュリティ/ノイド"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-190:back-turn-end",
    cardId: "STD-190",
    event: "turn_ended",
    conditions: [{ type: "source_zone", zone: "back" }],
    actions: [op("deal_damage", { target: "enemy_user", amount: 2 })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
