// STD-116 /アサルトプログラム/*
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-116",
  "name": "/アサルトプログラム/*",
  "category": "Sp",
  "color": "青",
  "cost": 5,
  "classes": [],
  "text": "このターン、自分のエレクトロンフェアリーは[ハッキング]と「ユーザーへの攻撃成功時、カードを1枚引き相手に1ダメージ。」を得る。",
  "sourceId": "STD-116",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("grant_keyword", { target: "own_class_ob_all", className: "エレクトロンフェアリー", keyword: "HACKING", duration: "turn" }),
    op("set_flag", { target: "own_class_ob_all", className: "エレクトロンフェアリー", flag: "assaultProgramTurn", value: { expression: "turn_number" } })
  ]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "turn_grant_attack_success", target: "own_class_snapshot", className: "エレクトロンフェアリー", keyword: "Hacking", onUserAttackSuccess: [{ type: "draw", value: 1 }, { type: "deal_damage", target: "enemy_user", value: 1 }] };
