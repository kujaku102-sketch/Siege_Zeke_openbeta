// STD-154 不屈マンドラゴラ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-154",
  "name": "不屈マンドラゴラ",
  "category": "Ob",
  "color": "黒",
  "cost": 2,
  "atk": 1,
  "str": 1,
  "classes": [
    "イモータルス"
  ],
  "text": "このカードがエリアからゴミ箱に置かれた次ターン開始時、ゴミ箱のこのカードをスリープして配置する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("area_to_trash", [op("schedule_delayed", {
    event: "turn_started", timing: "next_controller_turn", action: "move_source_from_trash",
    destination: "choose_area", resetDamage: true, sleep: true
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "area_to_trash_next_turn_revive", target: "source_uid", destination: "choose_area", enterSleep: true };
