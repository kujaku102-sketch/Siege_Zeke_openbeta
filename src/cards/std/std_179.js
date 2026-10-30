// STD-179 噛みつきバッタ
export const definition = {
  "id": "STD-179",
  "name": "噛みつきバッタ",
  "category": "Ob",
  "color": "緑",
  "cost": 2,
  "atk": 1,
  "str": 3,
  "classes": [],
  "text": "自分のScriptが起動した時、手札からこのObを配置できる。",
  "traits": [
    "インセクト"
  ]
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "optional_hand_place_on_own_script_activated", target: "self", free: true };
