// STD-033 クリティカルチェスト
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-033",
  "name": "クリティカルチェスト",
  "category": "Sp",
  "color": null,
  "cost": 5,
  "classes": [],
  "text": "相手エリアにあるカード1枚を破壊する。相手に2ダメージ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("destroy", { target: "selected_enemy_area_card" }),
    op("deal_damage", { target: "enemy_user", amount: 2 })
  ]);
