// STD-146 祝福の援軍
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-146",
  "name": "祝福の援軍",
  "category": "Sp",
  "color": "黄",
  "cost": 4,
  "text": "ゴミ箱から元々のメモリがX未満のOb1体をデコードする。Xはゴミ箱の「ナイツ・オブ・マキナ」および[セキュリティ]を持つカードの合計枚数である。",
  "rulingOverride": "STD-146: NOMとSecurityの和をX、元メモリX未満のObをゴミ箱からデコード",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("decode", {
    filter: {
      category: "Ob",
      originalMemoryMaximumExclusive: {
        expression: "own_trash_filter_union_count",
        filters: [{ className: "ナイツ・オブ・マキナ" }, { keyword: "SECURITY" }]
      }
    },
    count: 1
  })]);
