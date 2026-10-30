// STD-229 世界征服
export const definition = {
  "id": "STD-229",
  "name": "世界征服",
  "category": "Sp",
  "color": "橙",
  "cost": 5,
  "text": "レジストリのカード5枚を山札に戻すことで①を起動する。①自分は追加ターンを得る。この効果で得たターン中、相手に与えるダメージは-2される。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "registry_five_extra_turn", damageModifier: -2 };
