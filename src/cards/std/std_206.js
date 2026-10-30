// STD-206 ギガント・パッチワーク
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-206",
  "name": "ギガント・パッチワーク",
  "category": "Sp",
  "color": "紫",
  "cost": 1,
  "classes": [],
  "text": "自分の手札に『ドールズ』と『ドールズ・ギガンテス』それぞれ1枚を生成する。",
  "sourceId": "STD-206",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("generate", { cardIds: ["STD-189", "STD-205"], destination: "hand" })]);
