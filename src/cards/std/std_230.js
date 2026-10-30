// STD-230 悪の発明
export const definition = {
  "id": "STD-230",
  "name": "悪の発明",
  "category": "Sp",
  "color": "橙",
  "cost": 3,
  "text": "[アンブッシュ:3]相手の手札を見て、1枚をレジストリに加える。その後、ランダムにもう1枚選びレジストリに加える。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "ambush_hand_inspection_install", source: "own_faceup_registry", cost: 3, registryCardCountMinimum: "source_original_memory", choose: 1, randomAdditional: 1 };
