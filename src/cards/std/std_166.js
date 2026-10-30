// STD-166 冒涜的な歌
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-166",
  "name": "冒涜的な歌",
  "category": "Sp",
  "color": "黒",
  "cost": 3,
  "text": "自分エリアにクラス:旧支配者Obがあるなら、相手ユーザーに狂気カウンターを1つ置く。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("add_counter", {
    target: "enemy_user", counter: "madness", amount: 1,
    condition: { expression: "own_area_has_class_ob", className: "旧支配者" }
  })]);
