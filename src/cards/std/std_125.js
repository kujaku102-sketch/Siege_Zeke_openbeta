// STD-125 大盾の騎士
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-125",
  "name": "大盾の騎士",
  "category": "Ob",
  "color": "黄",
  "cost": 1,
  "atk": 1,
  "str": 1,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[セキュリティ][ログイン][OC+4]カードを2枚引く。+2/2する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [
    op("draw", { target: "source_controller", amount: 2, condition: { expression: "source_oc_paid_at_least", amount: 4 } }),
    op("modify_stats", { target: "source", atk: 2, str: 2, duration: "game", condition: { expression: "source_oc_paid_at_least", amount: 4 } })
  ]);
