// STD-132 「火除け」
export const definition = {
  "id": "STD-132",
  "name": "「火除け」",
  "category": "Ob",
  "color": "黄",
  "cost": 3,
  "atk": 1,
  "str": 4,
  "text": "[レスポンス:3][セキュリティ]",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "response_no_additional_effect", cost: 3, keyword: "Security" };
