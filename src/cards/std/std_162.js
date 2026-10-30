// STD-162 リィンカーネーション
export const definition = {
  "id": "STD-162",
  "name": "リィンカーネーション",
  "category": "Sp",
  "color": "黒",
  "cost": 2,
  "text": "自分Ob1体を破壊する。その後、元々のメモリ合計がX以下になるよう任意の枚数のObをサルベージする。Xはこうして破壊処理を行ったObの元々のSTR値である。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "destroy_lki_salvage", target: "one_own_ob", lki: "original_str", followUp: { source: "trash", filter: { category: "Ob" }, aggregateOriginalMemory: "lte_x", count: "any", destination: "hand" } };
