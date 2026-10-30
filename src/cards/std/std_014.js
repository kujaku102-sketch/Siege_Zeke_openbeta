// STD-014 ハックアンドスラッシュ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-014",
  "name": "ハックアンドスラッシュ",
  "category": "Sp",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "相手Ob1体に3ダメージ。この効果でObを破壊したならカードを1枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 3, recordAs: "damage_result" }),
    op("draw", { target: "source_controller", amount: 1, condition: { expression: "recorded_damage_destroyed", key: "damage_result" } })
  ]);
