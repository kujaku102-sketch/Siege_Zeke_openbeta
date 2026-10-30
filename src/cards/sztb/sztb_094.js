// SZTB-094 銃装重奏 十六夜マキナ
import { area, own } from "../kit.js";

export const definition = {
  "id": "SZTB-094",
  "sourceId": "SZTB094",
  "name": "銃装重奏 十六夜マキナ",
  "category": "Lyd-Ob",
  "printedCategory": "Lyd-Ob",
  "color": null,
  "cost": 5,
  "atk": 5,
  "str": 6,
  "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード合計3枚以上][ログイン]とターン終了時、Ob以外の名称:アームズバンド・カード1枚にアクセスしそれを手札に加える。相手がカードを実行した時これをスリープし、[弾倉]を持つSpを実行できる。",
  "classes": ["連合軍", "ノイド"]
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(["hand", ...area], { armsBand: true }, 3)] };
