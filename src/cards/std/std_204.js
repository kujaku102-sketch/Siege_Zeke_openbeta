// STD-204 乗っ取り
export const definition = {
  "id": "STD-204",
  "name": "乗っ取り",
  "category": "Script",
  "color": "紫",
  "cost": 3,
  "classes": [],
  "text": "[if:相手がObを実行する時]そのObを配置するかわりに『ドールズ・ギガンテス』1体を生成しそのレイヤーとして配置する。",
  "sourceId": "STD-204",
  "printedCategory": "Script",
  "atk": null,
  "str": null,
  "cardClass": null
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "execution_placement_replacement", trigger: "enemy_ob_executing", replacement: "generated_dolls_gigantes_with_executed_ob_as_layer" };
