// STD-032 辻斬り
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-032",
  "name": "辻斬り",
  "category": "Sp",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "相手のOb1体に3ダメージ。それがスリープしているならさらに3ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 3 }),
    op("deal_damage", { target: "selected_enemy_ob", amount: 3, condition: { expression: "selected_target_is_sleeping_ob" } })
  ]);
