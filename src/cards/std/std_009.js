// STD-009 第一種戦闘配置
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-009",
  "name": "第一種戦闘配置",
  "category": "Code",
  "color": null,
  "cost": 1,
  "classes": [],
  "text": "[アップデート:2]このターン中、自分のOb全てを+1/0する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("update", [op("modify_stats", {
    target: "own_ob_all", atk: 1, str: 0, duration: "turn"
  })]);
