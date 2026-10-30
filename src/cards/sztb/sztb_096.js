// SZTB-096 アームズバンド・ブリッツ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "SZTB-096",
  "sourceId": "SZTB096",
  "name": "アームズバンド・ブリッツ",
  "category": "Sp",
  "printedCategory": "Sp",
  "color": null,
  "cost": 3,
  "text": "[弾倉:1]相手Ob1体に5ダメージ。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("deal_damage", { target: "selected_enemy_ob", amount: 5 })]);
