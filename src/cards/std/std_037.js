// STD-037 緊急徴収
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-037",
  "name": "緊急徴収",
  "category": "Script",
  "color": null,
  "cost": 1,
  "text": "[if:相手のメモリ上限が効果で増加した時]相手のメモリを5消費する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [op("consume_memory", { target: "enemy_player", amount: 5 })]);
