// STD-136 「破華守り」
export const definition = {
  "id": "STD-136",
  "name": "「破華守り」",
  "category": "Ob",
  "color": "黄",
  "cost": 8,
  "atk": 4,
  "str": 8,
  "text": "[コンタクト]このObの攻撃宣言時、自分の他のObを破壊してこのObをスタンバイできる。このObと戦闘したObは次の相手のターンの始めにスタンバイしない。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "attack_optional_destroy_to_standby", target: "other_own_ob", followUp: { battledOb: { skipNextStandby: true } }, keyword: "Contact" };
