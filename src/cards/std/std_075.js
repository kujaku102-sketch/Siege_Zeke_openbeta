// STD-075 ジャンキー
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-075",
  "name": "ジャンキー",
  "category": "Ob",
  "color": "赤",
  "cost": 1,
  "atk": 1,
  "str": 1,
  "classes": [
    "レッドパンクス"
  ],
  "text": "[QA]ターン終了時、このObが攻撃していたら破壊する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("turn_end", [op("destroy", {
    target: "source",
    condition: { expression: "source_attacked_this_turn" }
  })]);
