// STD-108 末端エンジニア
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-108",
  "name": "末端エンジニア",
  "category": "Ob",
  "color": "青",
  "cost": 2,
  "atk": 1,
  "str": 2,
  "classes": [
    "ニュートロン・セキュリティ",
    "ギークス"
  ],
  "text": "[ログイン]エレクトロンフェアリー1枚にアクセスし、それを手札に加える。",
  "sourceId": "STD-108",
  "printedCategory": "Ob",
  "cardClass": "ニュートロン・セキュリティ/ギークス"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { className: "エレクトロンフェアリー" }, count: 1, destination: "hand"
  })]);
