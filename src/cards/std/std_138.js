// STD-138 シールドバッシュ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-138",
  "name": "シールドバッシュ",
  "category": "Sp",
  "color": "黄",
  "cost": 2,
  "text": "相手Ob1体にXダメージ。Xは自分エリアにある[セキュリティ]の数+1である。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("deal_damage", { target: "selected_enemy_ob", amount: { expression: "own_area_security_count_plus_one" } })]);
