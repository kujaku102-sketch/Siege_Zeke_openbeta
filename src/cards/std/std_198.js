// STD-198 スケア=アイアン=クロウ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-198",
  "name": "スケア=アイアン=クロウ",
  "category": "Ob",
  "color": "紫",
  "cost": 6,
  "atk": 6,
  "str": 6,
  "classes": [
    "ヴェンジェンス",
    "イモータルス"
  ],
  "text": "[ログイン]『ドールズ』3体を生成し配置する。自分の『ドールズ』は[コンタクト]を得る。",
  "sourceId": "STD-198",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/イモータルス"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("generate", { cardId: "STD-189", count: 3, destination: "choose_area" })]);
