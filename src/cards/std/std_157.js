// STD-157 魔術王ソロモン
export const definition = {
  "id": "STD-157",
  "name": "魔術王ソロモン",
  "category": "Ob",
  "color": "黒",
  "cost": 2,
  "atk": 1,
  "str": 2,
  "classes": [
    "ゴエティア",
    "ウィザード"
  ],
  "text": "[ログイン]または[アップデート:3]自分エリアの他のカード1枚を選び①を起動する。①対象カードを破壊しメモリX以下の黒のOb1体を手札から配置する。Xは対象カードの元々のメモリである。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "destroy_lki_place", trigger: ["login", "update_3"], target: "other_own_area_card", lki: "original_memory", followUp: { source: "hand", filter: { category: "Ob", color: "黒", originalMemory: "lte_x" }, destination: "area", free: true } };
