// STD-151 炸裂ガール
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-151",
  "name": "炸裂ガール",
  "category": "Ob",
  "color": "黒",
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [
    "サーヴァント"
  ],
  "text": "[ログアウト]相手の手札を1枚ランダムに捨てさせる。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("discard", { target: "random_enemy_hand", count: 1 })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "logout_random_discard", target: "enemy_hand", count: 1 };
