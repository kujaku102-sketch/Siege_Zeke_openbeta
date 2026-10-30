// STD-096 変形合体レッパオー・GS(ガトリングスタイル)
import { area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-096",
  "name": "変形合体レッパオー・GS(ガトリングスタイル)",
  "category": "Ob",
  "color": "赤",
  "cost": 4,
  "atk": 1,
  "str": 5,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[レイヤード:「変形合体レッパオー」1体とレッドパンクス1枚以上][オーバーライド:2X][QA]このObが攻撃する時、レイヤーを1枚破棄することでこれをスタンバイする。"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] };
