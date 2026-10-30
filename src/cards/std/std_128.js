// STD-128 歯車の守り手 ジョン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-128",
  "name": "歯車の守り手 ジョン",
  "category": "Ob",
  "color": "黄",
  "cost": 3,
  "atk": 2,
  "str": 2,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[ログイン]「ナイツ・オブ・マキナ」Ob1体にアクセスし、それを手札に加える。[OC+2]さらに、メモリ6以上・黃のOb1体にアクセスしそれを手札に加える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Ob", className: "ナイツ・オブ・マキナ" }, count: 1, destination: "hand",
    afterActions: [op("access", {
      filter: { category: "Ob", color: "黄", originalMemoryMinimum: 6 }, count: 1, destination: "hand",
      condition: { expression: "source_oc_paid_at_least", amount: 2 }
    })]
  })]);
