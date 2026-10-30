// STD-081 ジェネレーター・ジュン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-081",
  "name": "ジェネレーター・ジュン",
  "category": "Ob",
  "color": "赤",
  "cost": 4,
  "atk": 2,
  "str": 2,
  "classes": [
    "レッドパンクス",
    "ギークス"
  ],
  "text": "[ログイン]元々のメモリ合計2以下になるよう任意の枚数のCodeにアクセスし、それをドラッグする。",
  "rulingOverride": "STD-081-R66: 元々のメモリ合計を参照"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Code", originalMemoryMaximum: 2 }, mode: "up_to", minimum: 0, maximum: "all",
    totalOriginalMemoryMaximum: 2, destination: "drag", enterSleep: false
  })]);
