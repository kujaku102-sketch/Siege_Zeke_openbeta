// STD-143 叛逆の機械螺子
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-143",
  "name": "叛逆の機械螺子",
  "category": "Sp",
  "color": "黄",
  "cost": 5,
  "classes": [],
  "text": "[レスポンス:6]相手Obすべてをスリープする。このSpを相手ターンに起動したなら、カードを2枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("sleep", { target: "enemy_ob_all" }),
    op("draw", { target: "source_controller", amount: 2, condition: { expression: "opponent_turn" } })
  ]);
