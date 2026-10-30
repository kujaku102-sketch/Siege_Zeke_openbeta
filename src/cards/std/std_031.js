// STD-031 ドラゴン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-031",
  "name": "ドラゴン",
  "category": "Ob",
  "color": null,
  "cost": 6,
  "atk": 5,
  "str": 6,
  "classes": [
    "連合軍",
    "ドラゴン"
  ],
  "text": "[QA]これを持ったObは配置されたターンに攻撃できます。このObの攻撃時に相手エリアのObを1体破壊する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("attack_declared", [op("select", {
    selector: { owner: "enemy", zones: ["area"], category: "Ob" }, count: 1,
    label: "攻撃時効果で破壊する相手Obを選択",
    afterActions: [op("destroy", { target: "selected_enemy_area_card" })]
  })], { settleMissingTargetAsCompleted: true });
