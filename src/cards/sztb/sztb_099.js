// SZTB-099 アームズバンド・リロード
import { op, spec } from "../kit.js";

export const definition = {
  "id": "SZTB-099",
  "sourceId": "SZTB099",
  "name": "アームズバンド・リロード",
  "category": "Sp",
  "printedCategory": "Sp",
  "color": null,
  "cost": 3,
  "text": "[弾倉:1]カードを2枚引く。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("draw", { target: "source_controller", amount: 2 })]);
