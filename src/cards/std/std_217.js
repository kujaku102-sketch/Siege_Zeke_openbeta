// STD-217 岩投怪人 ホーリーゲル
export const definition = {
  "id": "STD-217",
  "name": "岩投怪人 ホーリーゲル",
  "category": "Ob",
  "color": "橙",
  "cost": 3,
  "atk": 3,
  "str": 1,
  "classes": [
    "微橙院",
    "エレクトロン・フェアリー"
  ],
  "text": "自分のレジストリからカードが離れる度、相手に1ダメージ。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "own_registry_left_damage", target: "enemy_user", value: 1 };
