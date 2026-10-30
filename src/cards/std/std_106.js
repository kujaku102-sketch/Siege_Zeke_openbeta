// STD-106 烈火の重武装特攻車(ファイアタンカー・レッカー)
import { area, exact } from "../kit.js";

export const definition = {
  "id": "STD-106",
  "name": "烈火の重武装特攻車(ファイアタンカー・レッカー)",
  "category": "LOb",
  "color": "赤",
  "cost": 6,
  "atk": 6,
  "str": 6,
  "classes": [
    "レッドパンクス",
    "ビルダー"
  ],
  "text": "[レイヤード:レッドパンクスOb1体とオートメイル1枚]攻撃時、『ジャンクパーツ』2枚を配置する。[プロキシ:2]『ジャンクパーツ』1枚を配置する。"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { className: "レッドパンクス", isOb: true }), exact(area, { className: "オートメイル" })] };
