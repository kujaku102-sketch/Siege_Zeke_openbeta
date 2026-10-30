// STD-152 ゾンビメイカー
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-152",
  "name": "ゾンビメイカー",
  "category": "Ob",
  "color": "黒",
  "cost": 3,
  "atk": 1,
  "str": 2,
  "classes": [
    "ウィザード"
  ],
  "text": "[ログイン]または[アップデート:2]メモリ2以下のOb1体をデコードする。そのObはこのターン終了時に破壊される。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("decode", {
      filter: { category: "Ob", originalMemoryMaximum: 2 }, count: 1, destroyAtTurnEnd: true
    })]),
    spec("update", [op("decode", {
      filter: { category: "Ob", originalMemoryMaximum: 2 }, count: 1, destroyAtTurnEnd: true
    })])
  );
