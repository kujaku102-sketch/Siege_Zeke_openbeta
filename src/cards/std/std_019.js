// STD-019 X-ray Shot
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-019",
  "name": "X-ray Shot",
  "category": "Script",
  "color": null,
  "cost": 2,
  "text": "[if:カードを配置した時]そのカードと同じ色の手札1枚を捨て、対象を破壊する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [
    op("destroy", { target: "activation_target" })
  ], {
    additionalCost: {
      type: "discard", source: "hand", count: 1,
      matchEventField: "color", label: "追加コストとして捨てる同色カードを選択"
    }
  });
