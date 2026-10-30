// STD-015 ショックガン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-015",
  "name": "ショックガン",
  "category": "Sp",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "[レスポンス:1]相手Ob1体に2ダメージ。相手ユーザーに1ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 2, optionalTarget: true }),
    op("deal_damage", { target: "enemy_user", amount: 1 })
  ]);
