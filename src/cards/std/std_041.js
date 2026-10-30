// STD-041 頼れる先輩軍人 ガゴウ
import { op, spec, modifier } from "../kit.js";

export const definition = {
  "id": "STD-041",
  "name": "頼れる先輩軍人 ガゴウ",
  "category": "Ob",
  "color": null,
  "cost": 3,
  "atk": 1,
  "str": 1,
  "text": "自分の効果テキストを持たないObの与えるダメージを+1する。[ログアウト]合計メモリが2以下になるようObを2体までデコードする。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("decode", {
    filter: { category: "Ob" }, mode: "up_to", minimum: 0, maximum: 2,
    totalOriginalMemoryMaximum: 2, destination: "choose_area"
  })]);

// damage modifiers (was damage-modifier-specs.js)
export const damageModifierSpecs = Object.freeze([
    modifier({ direction: "dealt", sourceFilter: { category: "Ob", effectText: "none" }, amount: 1 })
  ]);
