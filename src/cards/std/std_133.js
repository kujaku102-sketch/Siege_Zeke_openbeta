// STD-133 栄光の騎士　セフィラ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-133",
  "name": "栄光の騎士　セフィラ",
  "category": "Ob",
  "color": "黄",
  "cost": 5,
  "atk": 4,
  "str": 3,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[QA][ログイン]自分エリアの[セキュリティ]1体につきカードを1枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("draw", { target: "source_controller", amount: { expression: "own_area_security_count" } })]);
