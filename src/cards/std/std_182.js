// STD-182 大王サソリ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-182",
  "name": "大王サソリ",
  "category": "Ob",
  "color": "緑",
  "cost": 5,
  "atk": 5,
  "str": 5,
  "text": "[レスポンス:5][コンタクト][ログイン]手札から設置メモリ2以下のScript1枚を設置する。攻撃時、起動メモリ2以下の自分のScript1枚を起動できる。",
  "classes": [],
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["hand"], category: "Script", originalSetupMemoryMaximum: 2 },
    count: 1,
    afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "back", free: true, forced: true, asScript: true })]
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "login_set_script_and_attack_activate_script", login: { source: "own_hand", category: "Script", setupMemoryMaximum: 2 }, attack: { source: "own_back", category: "Script", activationMemoryMaximum: 2, optional: true } };
