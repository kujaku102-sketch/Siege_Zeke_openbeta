// STD-040 兵士長 デュース
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-040",
  "name": "兵士長 デュース",
  "category": "Ob",
  "color": null,
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [],
  "text": "[ログイン]効果テキストを持たないOb1体にアクセスし、それをスリープしてドラッグする。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Ob", effectText: "none" }, count: 1, destination: "drag", enterSleep: true
  })]);
