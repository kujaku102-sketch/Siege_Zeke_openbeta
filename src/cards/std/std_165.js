// STD-165 旧支配者の呼び声
export const definition = {
  "id": "STD-165",
  "name": "旧支配者の呼び声",
  "category": "Script",
  "color": "黒",
  "cost": 6,
  "text": "[レジデント]カードが破壊された時、それがこのターン4体目以降ならこのカードを破壊してゴミ箱または手札のカテゴリ:旧支配者Ob1体をメモリを消費せずログインさせる。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_destruction_threshold", threshold: 4, count: "destroyed_cards_this_turn", cost: "destroy_source", followUp: { executeFreeLogin: { zones: ["trash", "hand"], category: "Ob", className: "旧支配者" } } };
