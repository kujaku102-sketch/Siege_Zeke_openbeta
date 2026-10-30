// STD-216 三級戦闘員
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-216",
  "name": "三級戦闘員",
  "category": "Ob",
  "color": "橙",
  "cost": 3,
  "atk": 3,
  "str": 3,
  "classes": [
    "微橙院",
    "イモータルス"
  ],
  "text": "[ログイン]山札の上1枚をレジストリにインストールする。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("move", { target: "deck_top", destination: "registry", count: 1 })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "login_install_deck_top" };
