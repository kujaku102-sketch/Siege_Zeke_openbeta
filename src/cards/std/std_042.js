// STD-042 偵察兵 ダイン
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-042",
  "name": "偵察兵 ダイン",
  "category": "Ob",
  "color": null,
  "cost": 1,
  "atk": 1,
  "str": 1,
  "classes": [],
  "text": "[ログイン]効果テキストを持たないOb2枚にアクセスし、それを手札に加える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Ob", effectText: "none" }, count: 2, destination: "hand"
  })]);
