// STD-186 地虫の豊穣
import { op, spec } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-186",
  "name": "地虫の豊穣",
  "category": "Script",
  "color": "緑",
  "cost": null,
  "classes": [],
  "text": "相手がカードを引いた時起動できる。カードを1枚引く。",
  "setupCost": 1,
  "activationCost": 0,
  "printedCost": "1-0",
  "traits": [
    "インセクト"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [op("draw", { target: "source_controller", amount: 1 })]);

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-186:enemy-card-drawn",
    cardId: "STD-186",
    event: "card_drawn",
    activation: "optional",
    conditions: [
      { type: "source_zone", zone: "back" },
      { type: "source_face_down" },
      { type: "event_player_is_enemy" }
    ],
    actions: []
  })
];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "optional_enemy_draw_trigger", trigger: { event: "card_drawn", controller: "opponent" }, effect: { type: "draw", target: "source_controller", value: 1 } };
