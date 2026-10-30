// STD-231 帝国式肉体改造
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-231",
  "name": "帝国式肉体改造",
  "category": "Script",
  "color": "橙",
  "cost": 3,
  "text": "[相手がObを実行する時]そのObの両隣りに『征服の証』をそれぞれ生成し配置する。",
  "classes": []
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-231:enemy-ob-executing", cardId: "STD-231", event: "card_executed", activation: "optional",
    conditions: [{ type: "source_zone", zone: "back" }, { type: "source_face_down" }, { type: "event_player_is_enemy" }, { type: "event_card_category", category: "Ob" }],
    actions: []
  })
];
