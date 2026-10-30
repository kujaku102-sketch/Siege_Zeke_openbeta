// STD-012 デフラグ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-012",
  "name": "デフラグ",
  "category": "Sp",
  "color": null,
  "cost": 0,
  "classes": [],
  "text": "プレイヤーを1人選ぶ。そのプレイヤーはゴミ箱を全てデッキにもどす。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("select_player", {
    filter: { trashNonEmpty: true }, recordAs: "selected_player",
    afterActions: [op("move_all", {
      source: "recorded_player_trash", destination: "recorded_player_deck", playerRecord: "selected_player", shuffleAfter: true, excludeSource: true
    })]
  })]);
