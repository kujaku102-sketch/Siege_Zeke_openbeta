// STD-207 クラフト・パッチワーク
export const definition = {
  "id": "STD-207",
  "name": "クラフト・パッチワーク",
  "category": "Sp",
  "color": "紫",
  "cost": 1,
  "classes": [],
  "text": "[レスポンス:3]『ドールズ』1枚を手札に生成し、①を起動する。①手札の紫のカード1枚を公開する。公開している間その実行メモリは-2される。",
  "sourceId": "STD-207",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "response_generate_reveal", cost: 3, generate: { cardId: "STD-189", destination: "hand" }, reveal: "one_purple_hand", revealedExecutionCostModifier: -2 };
