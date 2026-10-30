// STD-185 クワガタ将軍
export const definition = {
  "id": "STD-185",
  "name": "クワガタ将軍",
  "category": "Ob",
  "color": "緑",
  "cost": 7,
  "atk": 5,
  "str": 9,
  "text": "[QA]自分のクラス:インセクトは戦闘時、+3/0する。",
  "classes": [],
  "traits": [
    "インセクト"
  ]
};

// aura: while this is in the area, the owner's Insects get +3 ATK in a battle (the bonus applies to both attacker and defender)
export const auraBattleStatSpec = [{ providerZone: "area", target: "own_trait_ob_all", trait: "インセクト", atk: 3, str: 0 }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "aura_battle_stat_modifier", target: "own_trait_ob_all", trait: "インセクト", atk: 3, str: 0 };
