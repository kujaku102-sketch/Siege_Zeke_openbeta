// STD-195 マーダードールズ=トライプビア
import { op, area, own } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-195",
  "name": "マーダードールズ=トライプビア",
  "category": "Ob",
  "color": "紫",
  "cost": 4,
  "atk": 4,
  "str": 4,
  "classes": [
    "マスターピース"
  ],
  "text": "[レイヤード:「ドールズ」Ob2体以上][セキュリティ]レイヤーを1枚破棄することでこれを移動する消費メモリを1にできる。これが移動した時スタンバイする。",
  "sourceId": "STD-195",
  "printedCategory": "Lyd-Ob",
  "cardClass": "マスターピース"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(area, { name: "ドールズ", isOb: true }, 2)] };

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-195:self-moved",
    cardId: "STD-195",
    event: "card_moved",
    conditions: [{ type: "event_card_is_source" }],
    actions: [op("standby", { target: "source" })]
  })
];
