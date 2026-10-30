// STD-155 執念のコンキスタドール
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-155",
  "name": "執念のコンキスタドール",
  "category": "Ob",
  "color": "黒",
  "cost": 2,
  "atk": 1,
  "str": 3,
  "classes": [
    "イモータルス"
  ],
  "text": "[ログイン]自分のOb1体を破壊して①を起動できる。①カードを2枚引く。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["area"], category: "Ob" },
    mode: "up_to", minimum: 0, maximum: 1, skipAfterActionsWhenEmpty: true,
    label: "破壊する自分Obを0～1体選択",
    afterActions: [
      op("destroy", { target: "selected_own_ob" }),
      op("draw", { target: "source_controller", amount: 2 })
    ]
  })]);
