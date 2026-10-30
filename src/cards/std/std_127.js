// STD-127 兵長 不殺のレオ
import { modifier } from "../kit.js";

export const definition = {
  "id": "STD-127",
  "name": "兵長 不殺のレオ",
  "category": "Ob",
  "color": "黄",
  "cost": 3,
  "atk": 3,
  "str": 6,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[セキュリティ]このObがObとの戦闘で与えるダメージは0になる。"
};

// damage modifiers (was damage-modifier-specs.js)
export const damageModifierSpecs = Object.freeze([
    modifier({
      direction: "dealt",
      sourceFilter: "provider",
      damageKind: "battle",
      destination: "card",
      operation: "set",
      amount: 0
    })
  ]);
