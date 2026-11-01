// STD-178 ムカデの隊列
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-178",
  "name": "ムカデの隊列",
  "category": "Sc",
  "printedCategory": "Sc",
  "color": "緑",
  "cost": 1,
  "classes": [],
  "text": "[レジデント][アップデート:2]次のターン終了時まで自分のObすべてを+2/+2して[セキュリティ]を与える。",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("update", [op("modify_stats", {
    target: "own_ob_all", atk: 2, str: 2, keyword: "SECURITY", duration: "through_next_turn"
  })]);
