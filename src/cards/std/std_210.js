// STD-210 漣縫(さざなみ ぬい)
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-210",
  "name": "漣縫(さざなみ ぬい)",
  "category": "Ob",
  "color": "紫",
  "cost": 2,
  "atk": 0,
  "str": 1,
  "classes": [
    "ヴェンジェンス",
    "ギークス"
  ],
  "text": "[ログイン]または[アップデート:3]名称:パッチワークSp1枚にアクセスしそれを手札に加え公開する。この効果で加えたカードはターン中、実行メモリを-2する。",
  "sourceId": "STD-210",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/ギークス"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("access", {
      filter: { category: "Sp", nameIncludes: "パッチワーク" }, count: 1, destination: "hand", reveal: true,
      afterActions: [op("modify_execution_cost", { target: "selected_cards", amount: -2, duration: "turn" })]
    })]),
    spec("update", [op("access", {
      filter: { category: "Sp", nameIncludes: "パッチワーク" }, count: 1, destination: "hand", reveal: true,
      afterActions: [op("modify_execution_cost", { target: "selected_cards", amount: -2, duration: "turn" })]
    })])
  );
