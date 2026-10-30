// STD-090 サプライヤー・カネコ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-090",
  "name": "サプライヤー・カネコ",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [
    "レッドパンクス"
  ],
  "text": "[ログイン]「ジャンクパーツ」1枚にアクセスし、それをドラッグする。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { name: "ジャンクパーツ" }, count: 1, destination: "drag", enterSleep: false
  })]);
