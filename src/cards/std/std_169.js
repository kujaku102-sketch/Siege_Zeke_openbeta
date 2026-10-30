// STD-169 怠惰侯爵ベルフェゴル
import { op } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-169",
  "name": "怠惰侯爵ベルフェゴル",
  "category": "Ob",
  "color": "黒",
  "cost": 5,
  "atk": 1,
  "str": 6,
  "classes": [
    "ｗｗｗ"
  ],
  "text": "[プロキシ:3]相手Ob1体を選び、それに[負荷]を3つ与える。このObの戦闘時、相手Obに[負荷]を2つ与える。"
};

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-169:battle-load", cardId: "STD-169", event: "battle_started",
    conditions: [{ type: "source_card_is_battler" }],
    actions: [op("add_counter", { target: "enemy_battler", counter: "load", amount: 2 })]
  })
];
