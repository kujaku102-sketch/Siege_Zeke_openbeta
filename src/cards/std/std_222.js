// STD-222 世界線の跳躍
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-222",
  "name": "世界線の跳躍",
  "category": "Sp",
  "color": "橙",
  "cost": 2,
  "classes": [],
  "text": "手札を全てレジストリにインストールし、その枚数分カードを引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("move_all", { source: "own_hand", destination: "registry", recordAs: "moved_count" }),
    op("draw", { target: "source_controller", amount: { expression: "recorded_count", key: "moved_count" } })
  ]);
