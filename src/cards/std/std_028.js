// STD-028 騎馬兵
export const definition = {
  "id": "STD-028",
  "name": "騎馬兵",
  "category": "Ob",
  "cost": 3,
  "atk": 5,
  "str": 3,
  "classes": [
    "連合軍",
    "ノイド"
  ],
  "text": "[コンタクト]"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_keyword", keyword: "Contact" };
