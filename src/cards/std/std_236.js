// STD-236 不乱 健博士(みだれず たける)
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-236",
  "name": "不乱 健博士(みだれず たける)",
  "category": "Ob",
  "color": "橙",
  "cost": 5,
  "atk": 1,
  "str": 1,
  "classes": [
    "ｗｗｗ"
  ],
  "text": "[ログイン]山札のカード2枚にアクセスし、それをレジストリにインストールする。①1ターンに1度、レジストリからカードを実行できる。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["deck"] }, count: 2,
    afterActions: [
      op("move", { target: "selected_cards", source: "deck", destination: "registry", faceDown: false }),
      op("shuffle", { target: "own_deck" })
    ]
  })]);
