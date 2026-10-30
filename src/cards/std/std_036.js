// STD-036 キャッシュ・バック
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-036",
  "name": "キャッシュ・バック",
  "category": "Script",
  "color": null,
  "cost": 1,
  "text": "[if:自分Obが破壊された時]カードを2枚引く。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [op("draw", { target: "source_controller", amount: 2 })]);
