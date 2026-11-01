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
  "text": "[ログイン]『ドールズ』3体を生成し配置する。自分の『ドールズ』すべてを+1/0して[コンタクト]を与える。",
  "sourceId": "STD-198",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/イモータルス"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [
  op("generate", { cardId: "STD-189", count: 3, destination: "choose_area" }),
  op("modify_stats", { target: "own_named_ob_all", targetName: "ドールズ", atk: 1, str: 0, duration: "permanent" }),
  op("grant_keyword", { target: "own_named_ob_all", targetName: "ドールズ", keyword: "CONTACT", duration: "permanent" })
]);
