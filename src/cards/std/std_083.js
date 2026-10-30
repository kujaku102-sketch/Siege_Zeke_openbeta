// STD-083 マシーナリー・ボルツ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-083",
  "name": "マシーナリー・ボルツ",
  "category": "Ob",
  "color": "赤",
  "cost": 3,
  "atk": 2,
  "str": 2,
  "text": "[ログイン]マウントしているならクラス:レッドパンクスかつカテゴリ:Lyd-Obを1枚以上2枚まで可能な限りアクセスする。1枚を手札に加え、もう1枚をゴミ箱へ送る。",
  "rulingOverride": "STD-083-R67: 1枚以上2枚まで可能な限り",
  "classes": [
    "レッドパンクス"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Lyd-Ob", className: "レッドパンクス" }, mode: "up_to", minimum: 1, maximum: 2,
    destination: "distribute", destinations: ["hand", "trash"], condition: { expression: "source_is_mounted" }
  })]);
