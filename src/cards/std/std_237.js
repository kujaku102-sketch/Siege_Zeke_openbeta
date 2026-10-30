// STD-237 ドクター・カラヘンジ
export const definition = {
  "id": "STD-237",
  "name": "ドクター・カラヘンジ",
  "category": "Ob",
  "color": "橙",
  "cost": 2,
  "atk": 0,
  "str": 1,
  "text": "[アップデート:4]ランダムなOb1体を生成し配置する。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "update_random_ob_generate_place", cost: 4 };
