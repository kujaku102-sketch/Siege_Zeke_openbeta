// STD-233 デビルマスク
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-233",
  "name": "デビルマスク",
  "category": "Sp",
  "color": "橙",
  "cost": 1,
  "classes": [],
  "text": "自分の手札に『白い仮面』と『黒い仮面』それぞれ1枚を生成する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("generate", { cardIds: ["STD-234", "STD-235"], destination: "hand" })]);
