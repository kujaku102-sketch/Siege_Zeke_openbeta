// SZTB-093 銃装重奏 鉄ヶ崎カサネ
import { op, spec, area, exact } from "../kit.js";

export const definition = {
  "id": "SZTB-093",
  "sourceId": "SZTB093",
  "name": "銃装重奏 鉄ヶ崎カサネ",
  "category": "Lyd-Ob",
  "printedCategory": "Lyd-Ob",
  "color": null,
  "cost": 2,
  "atk": 1,
  "str": 2,
  "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード1枚ずつ][セキュリティ]これが攻撃される時、戦闘開始前に相手Obに2ダメージ。その後、『アームズバンド・ジャケット』1枚を生成し配置する。",
  "classes": ["連合軍", "ノイド"]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("attacked", [
    op("deal_damage", { target: "attack_target", amount: 2 }),
    op("generate", { cardId: "SZTB-091", count: 1, destination: "choose_area" })
  ]);

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(["hand"], { armsBand: true }), exact(area, { armsBand: true })] };
