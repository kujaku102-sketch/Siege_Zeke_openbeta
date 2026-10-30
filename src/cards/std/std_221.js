// STD-221 パラレルウィード・アタッカー
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-221",
  "name": "パラレルウィード・アタッカー",
  "category": "Ob",
  "color": "橙",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [],
  "text": "[ログイン]相手ユーザーに1ダメージ。これがレジストリから実行されていた場合、3ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("deal_damage", { target: "enemy_user", amount: { expression: "registry_execution_damage", normal: 1, registry: 3 } })]);
