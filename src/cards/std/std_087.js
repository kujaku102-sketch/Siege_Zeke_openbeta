// STD-087 とつげき☆おうえん団 グレン
import { op, spec, modifier } from "../kit.js";

export const definition = {
  "id": "STD-087",
  "name": "とつげき☆おうえん団 グレン",
  "category": "Ob",
  "color": "赤",
  "cost": 4,
  "atk": 1,
  "str": 4,
  "text": "[ログイン]メモリ1以下のObまたはCode1枚にアクセスし、それをドラッグする。自分の赤のカードによるダメージを+1する。",
  "rulingOverride": "STD-087-R73: 対象はObまたはCodeのみ",
  "classes": [
    "レッドパンクス"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("access", {
    filter: { categories: ["Ob", "Code"], originalMemoryMaximum: 1 }, count: 1, destination: "drag", enterSleep: false
  })]);

// damage modifiers (was damage-modifier-specs.js)
export const damageModifierSpecs = Object.freeze([
    modifier({ direction: "dealt", sourceFilter: { color: "赤" }, amount: 1 })
  ]);
