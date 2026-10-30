// STD-114 戦闘用素体F型 ライラ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-114",
  "name": "戦闘用素体F型 ライラ",
  "category": "Ob",
  "color": "青",
  "cost": 3,
  "atk": 2,
  "str": 4,
  "classes": [
    "ニュートロン・セキュリティ",
    "エレクトロン・フェアリー"
  ],
  "text": "[ハッキング]攻撃時、他の自分のOb1体に[ハッキング]を与える。",
  "sourceId": "STD-114",
  "printedCategory": "Ob",
  "cardClass": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("attack_declared", [op("select", {
    selector: { owner: "self", zones: ["area"], category: "Ob", excludeSource: true }, count: 1,
    label: "[ハッキング]を与える他の自分Obを選択",
    afterActions: [op("grant_keyword", { target: "selected_own_ob", keyword: "HACKING", duration: "game" })]
  })]);
