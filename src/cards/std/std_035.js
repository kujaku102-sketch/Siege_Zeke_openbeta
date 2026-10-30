// STD-035 進軍
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-035",
  "name": "進軍",
  "category": "Sp",
  "color": null,
  "cost": 5,
  "classes": [],
  "text": "クラス:連合軍Ob2枚にアクセスし、それらを手札に加える。その後、このターン自分のクラス:連合軍Obすべてを+1/0する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("access", {
    filter: { category: "Ob", className: "連合軍" }, count: 2, destination: "hand",
    afterActions: [op("modify_stats", { target: "own_class_ob_all", className: "連合軍", atk: 1, str: 0, duration: "turn" })]
  })]);
