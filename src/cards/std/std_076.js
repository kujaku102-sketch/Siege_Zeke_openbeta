// STD-076 こそ泥
export const definition = {
  "id": "STD-076",
  "name": "こそ泥",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 2,
  "str": 1,
  "text": "[バックアップ]",
  "classes": [
    "レッドパンクス"
  ]
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_destruction_replacement", keyword: "Backup", limit: "once_per_turn", condition: "front_and_back_space" };
