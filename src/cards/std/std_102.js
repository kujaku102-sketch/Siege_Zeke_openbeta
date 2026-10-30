// STD-102 簡易合体レッパ・ビギニング
import { area, own } from "../kit.js";

export const definition = {
  "id": "STD-102",
  "name": "簡易合体レッパ・ビギニング",
  "category": "Ob",
  "color": "赤",
  "cost": 5,
  "atk": 3,
  "str": 5,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[レイヤード:レッドパンクス1体以上+「ジャンク」カード1枚以上][QA]攻撃時、このObのレイヤー1枚をゴミ箱に送って①を起動できる。①メモリ合計が2になるように、ゴミ箱からObまたはCodeを任意の枚数選び配置する。レイヤーが1枚以下のこのObは破壊される。"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(area, { className: "レッドパンクス", isOb: true }), own(area, { nameIncludes: "ジャンク" })] };
