// STD-176 蜂の大群
import { op, spec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-176",
  "name": "蜂の大群",
  "category": "Script",
  "printedCategory": "Sc",
  "color": "緑",
  "cost": 0,
  "setupCost": 1,
  "activationCost": 0,
  "classes": [],
  "text": "相手ターン開始時に起動する。次のターン終了時まで、自分のObすべては[切断]を持つ。",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [op("grant_keyword", {
    target: "own_ob_all", keyword: "SLASH", duration: "through_next_turn_end"
  })]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-176:enemy-turn-start", cardId: "STD-176", event: "turn_started", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }],
    actions: []
  })
];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "enemy_turn_start_grant_all", target: "own_ob_all", keyword: "Slash", duration: "through_next_turn" };
