// SZTB-095 銃装重奏 赤羽チナツ
import { area, own } from "../kit.js";

export const definition = {
  "id": "SZTB-095",
  "sourceId": "SZTB095",
  "name": "銃装重奏 赤羽チナツ",
  "category": "Lyd-Ob",
  "printedCategory": "Lyd-Ob",
  "color": null,
  "cost": 7,
  "atk": 6,
  "str": 2,
  "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード合計3枚以上][QA]各ターン1度、自分が[弾倉]を持つSpを実行した後、それをゴミ箱に送るかわりにこれのレイヤーに加えることができる。[弾倉]によりレイヤーが消費された時、相手に1ダメージ。",
  "classes": ["連合軍", "ノイド"]
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(["hand", ...area], { armsBand: true }, 3)] };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "layered_magazine_support", oncePerTurn: "replace_magazine_sp_trash_with_source_layer", onMagazineLayerConsumed: "enemy_user_damage_1" };
