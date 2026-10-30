// STD-232 合体怪人 膨張のフットブロ
import { op, area, own } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "STD-232",
  "name": "合体怪人 膨張のフットブロ",
  "category": "Lyd-Ob",
  "printedCategory": "Lyd-Ob",
  "color": "橙",
  "cost": 3,
  "atk": 5,
  "str": 1,
  "classes": [],
  "text": "[レイヤード:自分エリアとレジストリのカード2枚以上]各ターン開始時、お互いの山札の上から1枚をこれのレイヤーに加える。[ログアウト]相手エリアのObを好きな数選び、Xを割り振ってダメージを与える。その後、これのレイヤーを全て所有ユーザーのレジストリにインストールする。Xはこれのレイヤーが持つメモリの合計である。"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own([...area, "registry"], {}, 2)] };

// trigger specs (was trigger-specs.js)
export const triggerSpecs = [
  createTriggerSpec({
    id: "STD-232:each-turn-start", cardId: "STD-232", event: "turn_started",
    conditions: [],
    actions: [op("move_each_deck_top_as_layer", { target: "source", owner: "each_player" })]
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;
