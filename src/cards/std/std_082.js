// STD-082 リメイカー・ジェイク
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-082",
  "name": "リメイカー・ジェイク",
  "category": "Ob",
  "color": "赤",
  "cost": 3,
  "atk": 3,
  "str": 2,
  "text": "[ログイン]山札の上から1枚をゴミ箱に送る。その後、ゴミ箱からメモリ3以下のCode1枚を配置する。",
  "classes": [
    "レッドパンクス"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [
    op("mill", { target: "own_deck_top", amount: 1, destination: "trash" }),
    op("decode", { filter: { category: "Code", originalMemoryMaximum: 3 }, count: 1, destination: "choose_area" })
  ]);
