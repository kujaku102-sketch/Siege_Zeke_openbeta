// STD-030 砲撃部隊
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-030",
  "name": "砲撃部隊",
  "category": "Ob",
  "color": null,
  "cost": 5,
  "atk": 3,
  "str": 3,
  "classes": [
    "連合軍",
    "ノイド"
  ],
  "text": "[ログイン]相手のOb1体と相手ユーザーに3ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "enemy", zones: ["area"], category: "Ob", effectTargeting: true },
    count: 1,
    continueWhenEmpty: true,
    label: "3ダメージを与える相手Obを選択",
    afterActions: [
      op("deal_damage", { target: "selected_enemy_ob", amount: 3 }),
      op("deal_damage", { target: "enemy_user", amount: 3 })
    ]
  })]);
