// STD-085 試作合体レッパオー・ゼロ
import { area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-085",
  "name": "試作合体レッパオー・ゼロ",
  "category": "Ob",
  "color": "赤",
  "cost": 6,
  "atk": 4,
  "str": 4,
  "text": "[レイヤード:レッドパンクスCode1枚以上とノイド1体][QA]攻撃時、レイヤー1枚をゴミ箱へ送り①を起動する。①+2/+0する。解決後、積層全体が1枚以下なら破壊される。",
  "rulingOverride": "STD-085-R72: 効果解決後に積層全体を判定",
  "classes": [
    "レッドパンクス"
  ]
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(area, { className: "レッドパンクス", category: "Code" }), exact(area, { className: "ノイド", isOb: true })] };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "layered_attack_cost_effect", cost: { layerToTrash: 1 }, effect: { atk: 2, str: 0 }, afterResolution: { destroyIfStackMaximum: 1 } };
