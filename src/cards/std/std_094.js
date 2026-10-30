// STD-094 変形合体レッパオー・G(ギガント)
import { op, spec, area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-094",
  "name": "変形合体レッパオー・G(ギガント)",
  "category": "Ob",
  "color": "赤",
  "cost": 7,
  "atk": 5,
  "str": 5,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[レイヤード:ノイド1体と1枚以上のレッドパンクス][QA][ログイン]相手フォートレスにXダメージ。XはこのObのレイヤーの数である。",
  "rulingOverride": "STD-094: Xは解決時点の積層全体（自身を含む）の枚数"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("deal_damage", { target: "enemy_user", amount: { expression: "source_stack_count" } })]);

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { className: "ノイド", isOb: true }), own(area, { className: "レッドパンクス" })] };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "layered_login_damage", requirement: { groups: [{ class: "ノイド", count: 1 }, { class: "レッドパンクス", minimum: 1 }] }, damage: { target: "enemy_user", value: "source_stack_count" } };
