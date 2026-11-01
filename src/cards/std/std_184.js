// STD-184 爆弾セミ
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-184",
  "name": "爆弾セミ",
  "category": "Ob",
  "color": "緑",
  "cost": 3,
  "atk": 3,
  "str": 3,
  "setupCost": 3,
  "activationCost": 0,
  "text": "Script扱いで設置できる。（Script;メモリ3　相手がカードを実行した時起動できる。これをフロントにドラッグする。）",
  "classes": [],
  "traits": [
    "インセクト"
  ]
};

// trigger specs: as a set Script (face down in the back) it may be activated when the opponent executes a card; the activation drags it to the front as the Ob it prints.
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-184:enemy-card-executed", cardId: "STD-184", event: "card_executed", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }],
    actions: [op("drag", { target: "source", zone: "front", becomes: { category: "Ob", clearFlags: ["std184Script"] } })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "dual_ob_script", scriptSetupMemory: 3, scriptActivationMemory: 0, scriptTrigger: "enemy_executes_card", scriptEffect: "drag_self_to_front" };
