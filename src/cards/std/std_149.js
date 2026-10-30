// STD-149 祈る力
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-149",
  "name": "祈る力",
  "category": "Sp",
  "color": "黄",
  "cost": 2,
  "classes": [],
  "text": "自分ライフを2回復し、カードを1枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("recover_damage", { target: "self_user", amount: 2 }),
    op("draw", { target: "source_controller", amount: 1 })
  ]);
