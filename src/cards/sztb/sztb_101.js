// SZTB-101 銃装重奏重工
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "SZTB-101",
  "sourceId": "SZTB101",
  "name": "銃装重奏重工",
  "category": "Script",
  "printedCategory": "Sc",
  "color": null,
  "cost": 3,
  "text": "[レジデント]自分のレイヤードに①を適用する。①[ログイン]と攻撃時、『アームズバンド・アマルガム』1枚を生成しレイヤーに加える。",
  "classes": []
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "SZTB-101:own-layered-login", cardId: "SZTB-101", event: "card_executed",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_family", family: "arms_band" },
      { type: "event_card_printed_category", category: "Lyd-Ob" }
    ],
    actions: [op("generate_as_layer", { cardId: "SZTB-090", target: "event_card" })]
  }),
  createTriggerSpec({
    id: "SZTB-101:own-layered-attack", cardId: "SZTB-101", event: "attack_declared",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_family", family: "arms_band" },
      { type: "event_card_printed_category", category: "Lyd-Ob" }
    ],
    actions: [op("generate_as_layer", { cardId: "SZTB-090", target: "event_card" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_arms_band_amalgam_layer_generation", triggers: [{ event: "layered_login", target: "own_arms_band_layered_ob" }, { event: "attack_declared", target: "own_arms_band_layered_ob" }], effect: { type: "generate_as_layer", cardId: "SZTB-090" } };
