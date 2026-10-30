// SZTB-092 銃装重装 種ヶ島ハジメ
import { op, spec, exact } from "../kit.js";

export const definition = {
  "id": "SZTB-092",
  "sourceId": "SZTB092",
  "name": "銃装重装 種ヶ島ハジメ",
  "category": "Lyd-Ob",
  "printedCategory": "Lyd-Ob",
  "color": null,
  "cost": 3,
  "atk": 1,
  "str": 1,
  "text": "[レイヤード:手札の名称:アームズバンド・カード1枚]これの攻撃宣言時、攻撃対象に3ダメージ与える。",
  "classes": ["連合軍", "ノイド"]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("attack_declared", [op("deal_damage", { target: "attack_target", amount: 3 })]);

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(["hand"], { armsBand: true })] };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "layered_attack_target_damage", amount: 3 };
