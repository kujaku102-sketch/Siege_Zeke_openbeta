// STD-026 重装歩兵
export const definition = {
  "id": "STD-026",
  "name": "重装歩兵",
  "category": "Ob",
  "cost": 3,
  "atk": 3,
  "str": 4,
  "classes": [
    "連合軍",
    "ノイド"
  ],
  "text": "[プロテクト:1]"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_component", component: "Protect", amount: 1, stackable: true };
