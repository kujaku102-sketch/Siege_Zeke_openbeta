// STD-203 傀儡特攻
export const definition = {
  "id": "STD-203",
  "name": "傀儡特攻",
  "category": "Sp",
  "color": "紫",
  "cost": 2,
  "classes": [],
  "text": "[レスポンス:1]自分のOb1体を破壊し、相手Ob1体に2ダメージ。この効果で相手Obが破壊された場合、同じ縦列のOb1体に2ダメージ。",
  "sourceId": "STD-203",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "response_grouped_cost_damage", cost: 1, groups: ["one_own_ob_destroy", "one_enemy_ob_damage_2"], followUp: "if_enemy_destroyed_damage_same_column_ob_2" };
