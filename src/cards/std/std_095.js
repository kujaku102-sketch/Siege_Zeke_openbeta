// STD-095 変形合体レッパオー・DS(ドリルスタイル)
import { area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-095",
  "name": "変形合体レッパオー・DS(ドリルスタイル)",
  "category": "Ob",
  "color": "赤",
  "cost": 7,
  "atk": 5,
  "str": 5,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[レイヤード:「変形合体レッパオー」1体とレッドパンクス1枚以上][オーバーライド:2X][コンタクト]攻撃中、+X/+0し、①を得る。①戦闘で破壊したObの元のSTR分のダメージを相手に与える。XはこのObの持つレイヤーの数である。",
  "rulingOverride": "オーバーライドは選択素材の元々のメモリ最大値を実行メモリから自動軽減"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] };
