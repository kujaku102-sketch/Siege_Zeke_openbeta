// STD-150 怨念人形
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-150",
  "name": "怨念人形",
  "category": "Ob",
  "color": "黒",
  "cost": 1,
  "atk": 1,
  "str": 1,
  "classes": [
    "サーヴァント"
  ],
  "text": "[ログアウト]相手のランダムなOb1体に1ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("deal_damage", { target: "random_enemy_ob", amount: 1 })]);
