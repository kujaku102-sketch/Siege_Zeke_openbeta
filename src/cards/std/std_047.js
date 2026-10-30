// STD-047 フィクス・インシデント
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-047",
  "name": "フィクス・インシデント",
  "category": "Sp",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "[レスポンス:2]クラス:フィクサーOb1体にアクセスし、それを手札に加える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("access", {
    filter: { category: "Ob", className: "フィクサー" }, count: 1, destination: "hand"
  })]);
