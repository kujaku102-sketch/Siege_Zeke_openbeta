// SZTB-098 アームズバンド・ジャムセッション
export const definition = {
  "id": "SZTB-098",
  "sourceId": "SZTB098",
  "name": "アームズバンド・ジャムセッション",
  "category": "Sp",
  "printedCategory": "Sp",
  "color": null,
  "cost": 5,
  "text": "[弾倉:4]自分の名称:アームズバンドObすべて+1/0する。ダメージを取り除きスタンバイする。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "magazine_arms_band_ready_then_generate_jacket", magazineCost: 4, effect: [{ type: "modify_stats", target: "own_named_ob_all", namePattern: "アームズバンド", atk: 1, str: 0, duration: "turn" }, { type: "remove_damage_and_standby", target: "own_named_ob_all", namePattern: "アームズバンド" }, { type: "generate_and_place", cardId: "SZTB-091", condition: "own_arms_band_ob_exists" }] };
