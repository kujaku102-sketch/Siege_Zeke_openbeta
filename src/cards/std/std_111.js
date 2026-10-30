// STD-111 /オフェンスプロトコル/*
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-111",
  "name": "/オフェンスプロトコル/*",
  "category": "Sp",
  "color": "青",
  "cost": 2,
  "classes": [],
  "text": "自分のOb1体はこのターン+1/+0され[ハッキング]を持つ。",
  "sourceId": "STD-111",
  "printedCategory": "Sp",
  "atk": null,
  "str": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("modify_stats", { target: "selected_own_ob", atk: 1, str: 0, duration: "turn" }),
    op("grant_keyword", { target: "selected_own_ob", keyword: "HACKING", duration: "turn" })
  ]);
