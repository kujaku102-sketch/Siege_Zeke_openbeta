// STD-205 ドールズ・ギガンテス
import { op, spec, modifier, area, own } from "../kit.js";

export const definition = {
  "id": "STD-205",
  "name": "ドールズ・ギガンテス",
  "category": "Ob",
  "printedCategory": "Lyd-Ob",
  "color": "紫",
  "cost": 3,
  "atk": 1,
  "str": 1,
  "classes": [
    "ヴェンジェンス",
    "アーティファクト"
  ],
  "text": "[レイヤード:Ob1体以上][セキュリティ][ログイン]これのレイヤー1枚につき+1/+1する。これがクラス:アーティファクトまたはマスターピースのカードから受けるダメージは-1される。",
  "sourceId": "STD-205",
  "cardClass": "ヴェンジェンス/アーティファクト"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("modify_stats", { target: "source", atk: 1, str: 1, multiplier: { expression: "source_layer_count" }, duration: "game" })]);

// damage modifiers (was damage-modifier-specs.js)
export const damageModifierSpecs = Object.freeze([
    modifier({
      direction: "received",
      sourceFilter: { classesAny: ["アーティファクト", "マスターピース"] },
      targetFilter: "provider",
      destination: "card",
      amount: -1
    })
  ]);

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(area, { isOb: true })] };
