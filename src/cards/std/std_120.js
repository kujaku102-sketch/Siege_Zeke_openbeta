// STD-120 情報管理端末Ⅲ型ゴモラ
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-120",
  "name": "情報管理端末Ⅲ型ゴモラ",
  "category": "Script",
  "printedCategory": "Sc",
  "color": "青",
  "cost": 3,
  "classes": [],
  "text": "[レジデント]各ターン1度、Spを起動した時①を起動する。①「/」で始まり「/*」で終わるメモリ2以下のSp1枚をゴミ箱から起動し、それをデッキに戻す。",
  "sourceId": "STD-120",
  "atk": null,
  "str": null,
  "cardClass": null
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-120:own-sp-executed", cardId: "STD-120", event: "card_executed", limit: "once_per_turn",
    conditions: [
      { type: "source_resident_active" },
      { type: "event_card_owner_is_source_controller" },
      { type: "event_card_category", category: "Sp" }
    ],
    actions: [op("select_execute_from_trash", {
      filter: { category: "Sp", namePattern: "slash_spell", maximumCost: 2 },
      destinationAfterExecution: "deck",
      shuffleAfter: true
    })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
