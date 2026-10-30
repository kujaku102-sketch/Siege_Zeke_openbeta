// STD-196 技師ストリカズラ
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-196",
  "name": "技師ストリカズラ",
  "category": "Ob",
  "color": "紫",
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [
    "ヴェンジェンス",
    "アーティスト"
  ],
  "text": "[ログイン]と[アップデート:3]所持ユーザーが同じとなるOb2体を選び、そのOb同士の位置を入れ替える。",
  "sourceId": "STD-196",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/アーティスト"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("select", {
      selector: { owner: "self", zones: ["area"], category: "Ob" }, count: 2,
      afterActions: [op("swap", { target: "selected_own_area_cards" })]
    })]),
    spec("update", [op("select", {
      selector: { owner: "self", zones: ["area"], category: "Ob" }, count: 2,
      afterActions: [op("swap", { target: "selected_own_area_cards" })]
    })])
  );
