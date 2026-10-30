// STD-103 メンテナンスボーイ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-103",
  "name": "メンテナンスボーイ",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [
    "レッドパンクス",
    "オートメイル"
  ],
  "text": "[ログイン]自分のLyd-Ob1体を選ぶ。そのObのレイヤーに対応するカード1枚をゴミ箱から選び、1番下のレイヤーに加える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["area"], printedCategory: "Lyd-Ob" }, count: 1, recordAs: "layer_host",
    afterActions: [op("select", {
      selector: { owner: "self", zones: ["trash"], correspondsToRecordedHost: "layer_host" }, count: 1,
      afterActions: [op("move", {
        target: "selected_cards", source: "trash", destination: "bottom_layer_of_recorded_host", hostRecord: "layer_host"
      })]
    })]
  })]);
