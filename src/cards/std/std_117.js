// STD-117 次世代試作素体Δ型 漣
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-117",
  "name": "次世代試作素体Δ型 漣",
  "category": "Ob",
  "color": "青",
  "cost": 6,
  "atk": 5,
  "str": 3,
  "classes": [
    "ニュートロン・セキュリティ",
    "エレクトロン・フェアリー"
  ],
  "text": "[バックアップ]攻撃時、ゴミ箱からSpまたはクラス:エレクトロンフェアリー1枚をサルベージする。フロントにある時①を、バックにある時②をそれぞれ適用する。①[ハッキング]②自分の青のOb全ては[暗号化]。",
  "sourceId": "STD-117",
  "printedCategory": "Ob",
  "cardClass": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("attack_declared", [op("select", {
    selector: {
      owner: "self", zones: ["trash"],
      anyOf: [{ category: "Sp" }, { className: "エレクトロンフェアリー" }]
    },
    count: 1, label: "攻撃時にサルベージするカードを選択",
    afterActions: [op("move", { target: "selected_cards", source: "trash", destination: "hand" })]
  })]);

// auraKeywordSpec (was continuous-effect-specs.js)
export const auraKeywordSpec = [
    { type: "grant_keyword", providerZone: "front", target: "source", keyword: "HACKING" },
    { type: "grant_keyword", providerZone: "back", target: "own_color_ob_all", color: "青", keyword: "ENCRYPTION" }
  ];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "position_dependent_attack_card", keyword: "Backup", onAttack: { salvage: { source: "own_trash", categories: ["Sp"], orClassName: "エレクトロンフェアリー", count: 1 } }, front: { grantSelf: "Hacking" }, back: { grantOwnColor: { color: "青", keyword: "Encryption" } } };
