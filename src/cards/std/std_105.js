// STD-105 緊急発進指令
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-105",
  "name": "緊急発進指令",
  "category": "Script",
  "color": "赤",
  "cost": 3,
  "text": "相手がフォートレスを攻撃する時起動できる。手札のLyd-Ob1体をメモリを支払わず強制実行する。この効果でログインしたObはスリープして[セキュリティ]を得、次のターン終了時に破壊される。",
  "classes": []
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-105:fortress-attacked", cardId: "STD-105", event: "attack_declared", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }, { type: "event_target_is_source_controller_fortress" }],
    actions: []
  })
];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "fortress_attack_interrupt", trigger: "enemy_attacks_own_fortress", execute: { source: "hand", owner: "self", controller: "activator", destination: { owner: "controller", zone: "area" }, category: "Lyd-Ob", forced: true, memoryCost: 0 }, followUp: { sleep: true, grant: "Security", destroyAt: "next_turn_end" } };
