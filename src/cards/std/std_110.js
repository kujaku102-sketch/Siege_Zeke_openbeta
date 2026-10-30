// STD-110 /セキュリティウォール/*
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-110",
  "name": "/セキュリティウォール/*",
  "category": "Sp",
  "color": "青",
  "cost": 1,
  "classes": [],
  "text": "次のターン終了時まで、自分のObすべては[暗号化]を持つ。",
  "sourceId": "STD-110",
  "printedCategory": "Sp",
  "atk": null,
  "str": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("grant_keyword", { target: "own_ob_all", keyword: "ENCRYPTION", duration: "through_next_turn_end" })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "grant_keyword_group", target: "own_ob_snapshot", keyword: "Encryption", expires: "next_turn_end" };
