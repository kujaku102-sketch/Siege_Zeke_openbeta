// STD-153 クロード・メル
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-153",
  "name": "クロード・メル",
  "category": "Ob",
  "color": "黒",
  "cost": 3,
  "atk": 2,
  "str": 4,
  "classes": [
    "オーバーロード"
  ],
  "text": "[ログイン][ログアウト]相手のOb1体に[負荷]を2つ与える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("select", {
      selector: { owner: "enemy", zones: ["area"], category: "Ob" }, count: 1,
      afterActions: [op("add_counter", { target: "selected_enemy_ob", counter: "load", amount: 2 })]
    })]),
    spec("logout", [op("select", {
      selector: { owner: "enemy", zones: ["area"], category: "Ob" }, count: 1,
      afterActions: [op("add_counter", { target: "selected_enemy_ob", counter: "load", amount: 2 })]
    })])
  );
