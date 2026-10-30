// STD-113 ビッグシスター
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-113",
  "name": "ビッグシスター",
  "category": "Ob",
  "color": "青",
  "cost": 5,
  "atk": 1,
  "str": 5,
  "classes": [
    "ニュートロン・セキュリティ",
    "ビルダー"
  ],
  "text": "[ログイン]と自分ターン開始時、手札からメモリ2以下のエレクトロンフェアリー1体を配置する。",
  "sourceId": "STD-113",
  "printedCategory": "Ob",
  "cardClass": "ニュートロン・セキュリティ/ビルダー"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("select", {
      selector: { owner: "self", zones: ["hand"], category: "Ob", className: "エレクトロンフェアリー", originalMemoryMaximum: 2 },
      count: 1,
      afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "area", free: true, forced: true })]
    })]),
    spec("turn_start", [op("select", {
      selector: { owner: "self", zones: ["hand"], category: "Ob", className: "エレクトロンフェアリー", originalMemoryMaximum: 2 },
      count: 1,
      afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "area", free: true, forced: true })]
    })])
  );

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "place_from_hand_trigger", triggers: ["login", "own_turn_start"], filter: { className: "エレクトロンフェアリー", originalMemoryLte: 2 }, count: 1, free: true };
