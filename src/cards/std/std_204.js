// STD-204 乗っ取り
export const definition = {
  "id": "STD-204",
  "name": "乗っ取り",
  "category": "Script",
  "color": "紫",
  "cost": 3,
  "classes": [],
  "text": "[if:相手がObを実行する時]その実行を『ドールズ・ギガンテス』1体の実行に置換する。",
  "sourceId": "STD-204",
  "printedCategory": "Script",
  "atk": null,
  "str": null,
  "cardClass": null
};

// execution replacement (core/execution-replacement.js): the opponent's Ob execution becomes an execution of STD-205 by the same user,
// where the original was going. The replaced Ob becomes its layer; its memory stays paid.
export const executionReplacementSpec = { trigger: "enemy_ob_executing", replaceWith: "STD-205", original: "layer" };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "execution_replacement", trigger: "enemy_ob_executing", replacement: "execution_of_dolls_gigantes" };
