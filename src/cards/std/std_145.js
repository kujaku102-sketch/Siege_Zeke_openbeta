// STD-145 補給部隊長 ヤハブ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-145",
  "name": "補給部隊長 ヤハブ",
  "category": "Ob",
  "color": "黄",
  "cost": 5,
  "atk": 3,
  "str": 3,
  "classes": [],
  "text": "[セキュリティ][ログアウト]メモリ上限を+1する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("increase_memory_limit", { target: "source_controller", amount: 1 })]);
