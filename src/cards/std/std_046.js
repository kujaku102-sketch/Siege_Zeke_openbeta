// STD-046 博打屋砲兵 アッシュ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-046",
  "name": "博打屋砲兵 アッシュ",
  "category": "Ob",
  "color": null,
  "cost": 3,
  "atk": 1,
  "str": 2,
  "text": "[コンタクト][ログイン]山札の上から3枚をゴミ箱に送る。こうしてゴミ箱に送られたOb1枚につき+1/+1する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [
    op("mill", { target: "own_deck_top", amount: 3, destination: "trash", recordAs: "milled_ob_to_trash", recordFilter: { category: "Ob" } }),
    op("modify_stats", { target: "source", atk: 1, str: 1, multiplier: { expression: "recorded_count", key: "milled_ob_to_trash" }, duration: "game",
      condition: { expression: "recorded_count_positive", key: "milled_ob_to_trash" } })
  ]);
