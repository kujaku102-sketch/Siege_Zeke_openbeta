// STD-184 爆弾セミ
export const definition = {
  "id": "STD-184",
  "name": "爆弾セミ",
  "category": "Ob",
  "color": "緑",
  "cost": 3,
  "atk": 3,
  "str": 3,
  "setupCost": 3,
  "activationCost": 0,
  "text": "3-0のScript扱いで設置できる。(Script時の効果:Obのログイン時、このカードをObとして配置できる。)",
  "classes": [],
  "traits": [
    "インセクト"
  ]
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "dual_ob_script", scriptSetupMemory: 3, scriptActivationMemory: 0, onObLogin: "place_self_as_ob" };
