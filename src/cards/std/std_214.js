// STD-214 超侵略型昆虫兵器トビケラス
export const definition = {
  "id": "STD-214",
  "name": "超侵略型昆虫兵器トビケラス",
  "category": "Ob",
  "color": "橙",
  "cost": 2,
  "atk": 5,
  "str": 5,
  "classes": [
    "微橙院",
    "インセクト"
  ],
  "text": "これの攻撃宣言時、カードを1枚レジストリから手札に加えなければ攻撃に失敗する。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "mandatory_attack_cost", cost: "recover_one_registry_card", failure: "attack_fails" };

// attack declaration cost (core/battle.js declarationCost): on declaring an attack the user may take 1 face-up card from the registry to hand; taking none fails the declaration
export const attackDeclarationCostSpec = Object.freeze({ source: "registry", count: 1, faceUp: true });
