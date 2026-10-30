// STD-213 サイコ・モザイコ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-213",
  "name": "サイコ・モザイコ",
  "category": "Ob",
  "color": "橙",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [
    "微橙院",
    "ノイド"
  ],
  "text": "[ログイン]手札を1枚裏向きでレジストリに加える。その後カードを1枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["hand"] }, count: 1,
    afterActions: [
      op("move", { target: "selected_cards", source: "hand", destination: "registry", faceDown: true }),
      op("draw", { target: "source_controller", amount: 1 })
    ]
  })]);
