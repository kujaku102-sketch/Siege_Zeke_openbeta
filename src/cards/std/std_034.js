// STD-034 ショックキャノン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-034",
  "name": "ショックキャノン",
  "category": "Sp",
  "color": null,
  "cost": 4,
  "classes": [],
  "text": "[レスポンス:3](相手からダメージを受けた時、[レスポンス]を持つカードを手札から指定のメモリを消費して使うことができます。)相手のOb1体に6ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("deal_damage", { target: "selected_enemy_ob", amount: 6 })]);
