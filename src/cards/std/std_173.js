// STD-173 知らせ虫
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-173",
  "name": "知らせ虫",
  "category": "Ob",
  "color": "緑",
  "cost": 1,
  "atk": 1,
  "str": 1,
  "classes": [],
  "text": "[ログイン]設置コスト1以下のScript1枚にアクセスし、それを手札に加える。",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { category: "Script", originalSetupMemoryMaximum: 1 }, count: 1, destination: "hand"
  })]);
