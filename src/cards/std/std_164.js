// STD-164 デス・キル・サツ・ゾーン
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-164",
  "name": "デス・キル・サツ・ゾーン",
  "category": "Script",
  "color": "黒",
  "cost": 4,
  "classes": [],
  "text": "[レジデント]自分のターン中、自分のカードが破壊される度、①または②を1つ選び起動する。①相手は自身の手札を1枚捨てる。②相手のOb1体を選び毒カウンターを2つ置く。"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-164:own-card-destroyed", cardId: "STD-164", event: "card_destroyed",
    conditions: [
      { type: "source_resident_active" },
      { type: "source_controller_is_active_player" },
      { type: "event_card_owner_is_source_controller" }
    ],
    actions: [op("choose_effect", { options: ["discard_enemy_hand", "poison_enemy_ob"] })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
