// STD-141 聖樹枝束(セフィラフォルダ)
export const definition = {
  "id": "STD-141",
  "name": "聖樹枝束(セフィラフォルダ)",
  "category": "Script",
  "color": "黄",
  "cost": null,
  "classes": [],
  "text": "[レジデント]各ターン終了時、このターン中に破壊された「聖樹」Scriptの数によりいずれかの効果を適用する。①2枚:「聖樹」カード2枚にアクセスし、1枚を手札に加え、残りをゴミ箱に送る。②3枚以上:「聖樹」カード3枚にアクセスし、うち1枚を自分エリアに設置する。残りはゴミ箱に送る。③5枚以上:手札から黄のOb1体を配置する。",
  "setupCost": 3,
  "activationCost": 0,
  "printedCost": "3-0"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_destroyed_count_branch", count: "destroyed_sacred_tree_scripts_this_turn", thresholds: [2, 3, 5] };
