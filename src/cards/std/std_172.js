// STD-172 穢れたもの
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-172",
  "name": "穢れたもの",
  "category": "VOb",
  "color": "黒",
  "cost": 1,
  "atk": 1,
  "str": 1,
  "token": true,
  "text": "[ログアウト]お互いのエリアか手札からランダムに1枚ずつBANする。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("move", {
    target: "random_each_player", source: "hand_and_area", destination: "ban", count: 1
  })]);
