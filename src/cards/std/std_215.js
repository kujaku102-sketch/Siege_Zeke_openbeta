// STD-215 多層怪人サイドラ
export const definition = {
  "id": "STD-215",
  "name": "多層怪人サイドラ",
  "category": "Ob",
  "color": "橙",
  "cost": 1,
  "atk": 1,
  "str": 2,
  "classes": [
    "微橙院",
    "エージェント"
  ],
  "text": "レジストリからこれを実行できる。[ログアウト]これをレジストリにインストールする。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "registry_executable_and_logout_install_self" };
