// STD-101 合吐労(アウトロー)・ライダー シュタイン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-101",
  "name": "合吐労(アウトロー)・ライダー シュタイン",
  "category": "Ob",
  "color": "赤",
  "cost": 4,
  "atk": 4,
  "str": 3,
  "classes": [
    "レッドパンクス",
    "ノイド"
  ],
  "text": "「ログイン」「ジャンクエンジン」1枚にアクセスし、それをドラッグする。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { name: "ジャンクエンジン" }, count: 1, destination: "drag", enterSleep: false
  })]);
