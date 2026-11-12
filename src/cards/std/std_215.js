// STD-215 多層怪人サイドラ
import { op, spec } from "../kit.js";

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

// [ログアウト]これをレジストリにインストールする: the card is in the trash by then (the logout trigger runs after the area exit)
export const runtimeSpec = spec("logout", [op("move", { target: "source", source: "trash", destination: "registry" })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "registry_executable_and_logout_install_self" };
