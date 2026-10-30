// STD-126 聖機構騎士団の伝令
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-126",
  "name": "聖機構騎士団の伝令",
  "category": "Ob",
  "color": "黄",
  "cost": 2,
  "atk": 1,
  "str": 3,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[セキュリティ][ログイン]他に「セキュリティ」を持つObが自分エリアにいるなら、カードを1枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("draw", { target: "source_controller", amount: 1, condition: { expression: "another_own_ob_has_security" } })]);
