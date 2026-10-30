// STD-043 装甲兵 メルク
export const definition = {
  "id": "STD-043",
  "name": "装甲兵 メルク",
  "category": "Ob",
  "cost": 2,
  "atk": 1,
  "str": 4,
  "text": "[セキュリティ]",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_keyword", keyword: "Security" };
