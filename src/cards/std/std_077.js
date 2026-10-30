// STD-077 ジャンカー・サム
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-077",
  "name": "ジャンカー・サム",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [
    "レッドパンクス",
    "ギークス"
  ],
  "text": "[ログイン]このObがマウントしているなら手札の「レッドパンクス」1枚を捨てる。そうしたら、カードを2枚引く。",
  "rulingOverride": "STD-077-R65: 捨てた場合のみ後続ドロー"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["hand"], className: "レッドパンクス" },
    count: 1,
    condition: { expression: "source_is_mounted" },
    afterActions: [
      op("discard", { target: "selected_cards", recordAs: "discarded_count" }),
      op("draw", {
        target: "source_controller", amount: 2,
        condition: { expression: "recorded_count_positive", key: "discarded_count" }
      })
    ]
  })]);
