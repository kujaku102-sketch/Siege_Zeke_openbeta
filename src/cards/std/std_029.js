// STD-029 大英雄
export const definition = {
  "id": "STD-029",
  "name": "大英雄",
  "category": "Ob",
  "cost": 5,
  "atk": 5,
  "str": 5,
  "classes": [
    "連合軍",
    "ノイド"
  ],
  "text": "[バックアップ]"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_destruction_replacement", keyword: "Backup", limit: "once_per_turn", condition: "front_and_back_space" };
