// STD-099 変形合体レッパオー・RB(リビルド)
import { op, spec, area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-099",
  "name": "変形合体レッパオー・RB(リビルド)",
  "category": "Ob",
  "color": "赤",
  "cost": 1,
  "atk": 1,
  "str": 1,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[レイヤード:「変形合体レッパオー」Ob1体とクラス:レッドパンクスのカード1枚以上]①このObは「変形合体レッパオー」Obが破壊される時、手札からメモリを消費せずログインできる。この時、対象Obを破壊するかわりにこのObのレイヤーにする。[ログイン]このObの持つレイヤー1枚につき+1/+1する。",
  "rulingOverride": "破壊置換はバックアップと同じ窓で排他的に選択"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("modify_stats", { target: "source", atk: 1, str: 1, multiplier: { expression: "source_layer_count" }, duration: "game" })]);

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "hand_destruction_replacement_login", timing: "same_as_backup", competingReplacements: "controller_choice_one", free: true, destroyedObBecomesLayer: true, loginBonusPerLayer: { atk: 1, str: 1 } };
