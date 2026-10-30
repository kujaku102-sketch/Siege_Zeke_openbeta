// STD-010 リブート
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-010",
  "name": "リブート",
  "category": "Sp",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "手札を全て捨てる。その後、捨てた枚数と同じだけカードを引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("discard", { target: "own_hand_all", recordAs: "discarded_count" }),
    op("draw", { target: "source_controller", amount: { expression: "recorded_count", key: "discarded_count" } })
  ]);
