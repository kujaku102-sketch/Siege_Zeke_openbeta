// STD-158 断章・レメゲトン
import { op, spec, multiSpec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-158",
  "name": "断章・レメゲトン",
  "category": "Code",
  "color": "黒",
  "cost": 3,
  "classes": [
    "ゴエティア"
  ],
  "text": "このカードは名称を「レメゲトン」としても扱う。[ログイン]または自分ターン開始時、黒のOb1体にアクセスしそれを手札に加える。[ログアウト]次のターン開始時、ゴミ箱のこのカードを手札に加える。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("access", { filter: { category: "Ob", color: "黒" }, count: 1, destination: "hand" })]),
    spec("turn_start", [op("access", { filter: { category: "Ob", color: "黒" }, count: 1, destination: "hand" })]),
    spec("logout", [op("schedule_delayed", {
      event: "turn_started", timing: "next_controller_turn", action: "move_source_from_trash",
      destination: "hand"
    })])
  );

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-158:turn-start-access", cardId: "STD-158", event: "turn_started",
    conditions: [{ type: "source_controller_is_event_player" }],
    actions: [op("access", { filter: { category: "Ob", color: "黒" }, count: 1, destination: "hand" })]
  })
];
