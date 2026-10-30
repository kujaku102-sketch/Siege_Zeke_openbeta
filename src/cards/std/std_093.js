// STD-093 サウンドマン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-093",
  "name": "サウンドマン",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [
    "レッドパンクス",
    "ノイド"
  ],
  "text": "[ログイン]「パンクス」を1体配置する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("generate", { factory: "punks_token", count: 1, destination: "choose_area" })]);
