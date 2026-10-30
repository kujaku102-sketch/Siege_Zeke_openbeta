// STD-086 グレンのラッキー☆ショット
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-086",
  "name": "グレンのラッキー☆ショット",
  "category": "Sp",
  "color": "赤",
  "cost": 2,
  "text": "相手のOb1体に3ダメージ。その後、自分エリアのカード1枚を破壊して①を起動できる。①相手ユーザーに2ダメージ。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("deal_damage", { target: "selected_enemy_ob", amount: 3 }),
    op("select", {
      selector: { owner: "self", zones: ["area"] }, mode: "up_to", minimum: 0, maximum: 1,
      label: "追加効果：自分エリアのカード1枚を破壊すると、相手ユーザーに2ダメージ",
      skipAfterActionsWhenEmpty: true,
      afterActions: [
        op("destroy", { target: "selected_own_area_card", recordAs: "destroyed_count" }),
        op("deal_damage", {
          target: "enemy_user", amount: 2,
          condition: { expression: "recorded_count_positive", key: "destroyed_count" }
        })
      ]
    })
  ]);
