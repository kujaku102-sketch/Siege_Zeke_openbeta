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

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "variable_decode", variable: { countUnion: ["own_trash_nom", "own_trash_security"] }, filter: { category: "Ob", originalMemory: "lt_x" }, count: 1 };
