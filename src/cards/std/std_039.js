// STD-039 大軍師 メイコウ
import { modifier } from "../kit.js";

export const definition = {
  "id": "STD-039",
  "name": "大軍師 メイコウ",
  "category": "Ob",
  "color": null,
  "cost": 6,
  "atk": 1,
  "str": 6,
  "text": "[ファイアウォール]自分が与えるダメージすべてを+1、受けるダメージを-1する。",
  "classes": []
};

// damage modifiers (was damage-modifier-specs.js)
export const damageModifierSpecs = Object.freeze([
    modifier({ direction: "dealt", amount: 1 }),
    modifier({ direction: "received", amount: -1 })
  ]);
