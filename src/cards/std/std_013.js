// STD-013 エクスプローラー
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-013",
  "name": "エクスプローラー",
  "category": "Sp",
  "color": null,
  "cost": 2,
  "classes": [],
  "text": "手札を1枚選び公開する。それと同じクラスを持つカード1枚にアクセスし、それを手札に加える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("access", {
    referenceSelection: { source: "own_hand", field: "classes", reveal: true },
    filter: { sharesFieldWithReference: "classes" }, count: 1, destination: "hand"
  })]);
