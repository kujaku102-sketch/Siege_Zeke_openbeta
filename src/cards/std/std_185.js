// STD-185 クワガタ将軍
export const definition = {
  "id": "STD-185",
  "name": "クワガタ将軍",
  "category": "Ob",
  "color": "緑",
  "cost": 7,
  "atk": 5,
  "str": 9,
  "text": "[QA]自分のインセクトが戦闘する時、かわりにこのObと戦闘させることができる。",
  "classes": [],
  "traits": [
    "インセクト"
  ]
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "optional_battle_substitution", condition: "own_insect_battles", substitute: "self" };
