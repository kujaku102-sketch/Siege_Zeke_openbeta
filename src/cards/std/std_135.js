// STD-135 不知死のシーグ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-135",
  "name": "不知死のシーグ",
  "category": "Ob",
  "color": "黄",
  "cost": 6,
  "atk": 1,
  "str": 1,
  "text": "[セキュリティ][ログアウト]ターン終了時、ゴミ箱のこのObを前線に配置する。",
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("schedule_delayed", {
    event: "turn_ended", timing: "current_turn_end", action: "move_source_from_trash",
    destination: "front", resetDamage: true, standby: true
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "logout_delayed_self_revive", timing: "current_turn_end", condition: { sourceZone: "trash" }, destination: "front", keyword: "Security" };
