// STD-144 「夜叉しさ」
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-144",
  "name": "「夜叉しさ」",
  "category": "Ob",
  "color": "黄",
  "cost": 3,
  "atk": 1,
  "str": 1,
  "classes": [],
  "text": "[セキュリティ][ログイン]自分のライフが相手より少ないなら、メモリ上限を+1する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("increase_memory_limit", {
    target: "source_controller", amount: 1, condition: { expression: "own_user_str_less_than_opponent" }
  })]);
