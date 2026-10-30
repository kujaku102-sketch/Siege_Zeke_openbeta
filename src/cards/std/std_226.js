// STD-226 反転怪人 バリース
export const definition = {
  "id": "STD-226",
  "name": "反転怪人 バリース",
  "category": "Ob",
  "color": "橙",
  "cost": 4,
  "atk": 3,
  "str": 1,
  "classes": [],
  "text": "このObがスタンバイ状態の時、相手がレジストリにカードをインストールした場合に①を起動できる。①このObをスリープし、レジストリのカード1枚を裏向きにする。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "optional_enemy_registry_install_compress", condition: "source_standby", cost: "sleep_self", target: "one_registry_card" };
