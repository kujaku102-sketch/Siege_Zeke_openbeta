// STD-044 突撃散弾銃
export const definition = {
  "id": "STD-044",
  "name": "突撃散弾銃",
  "category": "Ob",
  "cost": 2,
  "atk": 3,
  "str": 1,
  "text": "[QA]",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_keyword", keyword: "QA" };
