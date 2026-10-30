// STD-098 真・変形合体レッパオーSSS(スーパースタンドバイスタイル)
import { op, spec, area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-098",
  "name": "真・変形合体レッパオーSSS(スーパースタンドバイスタイル)",
  "category": "Ob",
  "color": "赤",
  "cost": 7,
  "atk": 5,
  "str": 10,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[レイヤード:「変形合体レッパオー」1体と2体以上のLyd-Ob][ログイン]このObのレイヤーにしたLyd-Ob1体につき①を起動する。①+2/+0し[QA]を持つ。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [
    op("modify_stats", { target: "source", atk: 2, str: 0, multiplier: { expression: "source_lyd_layer_count" }, duration: "game" }),
    op("grant_keyword", { target: "source", keyword: "QA", condition: { expression: "source_has_lyd_layer" }, duration: "game" })
  ]);

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { printedCategory: "Lyd-Ob" }, 2)] };
