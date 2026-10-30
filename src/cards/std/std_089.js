// STD-089 ドリル親父
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-089",
  "name": "ドリル親父",
  "category": "Ob",
  "color": "赤",
  "cost": 3,
  "atk": 1,
  "str": 1,
  "classes": [
    "レッドパンクス"
  ],
  "text": "[ログイン]自分のレイヤーを持つObすべてはこのターン、レイヤー1枚につき+1/0する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("modify_stats", {
    target: "own_mounted_ob_all", atk: 1, str: 0, perTargetMultiplier: "layer_count", duration: "turn"
  })]);
