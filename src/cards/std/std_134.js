// STD-134 騎士団長 不敗のアークツルス
import { op, spec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-134",
  "name": "騎士団長 不敗のアークツルス",
  "category": "Ob",
  "color": "黄",
  "cost": 7,
  "atk": 4,
  "str": 6,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[ログイン]次のターン、相手のObすべては攻撃しなければならない。自分の[セキュリティ]を持つObが攻撃された時、相手ユーザーに2ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("set_flag", { target: "enemy_player", flag: "forceAttack", value: true })]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-134:security-attacked", cardId: "STD-134", event: "attack_declared",
    conditions: [{ type: "event_player_is_enemy" }, { type: "event_target_is_own_security" }],
    actions: [op("deal_damage", { target: "enemy_user", amount: 2 })]
  })
];
