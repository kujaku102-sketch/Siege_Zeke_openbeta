// STD-188 コピー＆ペイスター
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-188",
  "name": "コピー＆ペイスター",
  "category": "Ob",
  "color": "紫",
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [
    "ヴェンジェンス",
    "ノイド"
  ],
  "text": "[ログイン]これ以外の自分フロントエリアのOb1体を選びバックに下げる。その後、『ドールズ』1体を生成し配置する。",
  "sourceId": "STD-188",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/ノイド"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["front"], category: "Ob", excludeSource: true },
    count: 1,
    afterActions: [
      op("move", { target: "selected_cards", source: "front", destination: "back" }),
      op("generate", { cardId: "STD-189", count: 1, destination: "choose_area" })
    ]
  })]);
