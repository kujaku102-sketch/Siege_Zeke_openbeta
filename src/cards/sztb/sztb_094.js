// SZTB-094 銃装重奏 十六夜マキナ
import { area, own } from "../kit.js";
import { createTriggerSpec } from "../../game/activation-windows.js";

export const definition = {
  "id": "SZTB-094",
  "sourceId": "SZTB094",
  "name": "銃装重奏 十六夜マキナ",
  "category": "Lyd-Ob",
  "printedCategory": "Lyd-Ob",
  "color": null,
  "cost": 5,
  "atk": 5,
  "str": 6,
  "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード合計3枚以上][ログイン]とターン終了時、Ob以外の名称:アームズバンド・カード1枚にアクセスしそれを手札に加える。相手がカードを実行した時これをスリープし、[弾倉]を持つSpを実行できる。",
  "classes": ["連合軍", "ノイド"]
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [own(["hand", ...area], { armsBand: true }, 3)] };

// trigger specs: 「相手がカードを実行した時これをスリープし、[弾倉]を持つSpを実行できる」は実行にトリガーして宣言される(スレッドに乗る)。
// 起動するかどうかは、効果が開く選択で決める(選ばず確定も可能)。起動できる[弾倉]Spが手札になければ誘発しない。
export const triggerSpecs = [
  createTriggerSpec({
    id: "SZTB-094:opponent-executes", cardId: "SZTB-094", event: "card_executed",
    conditions: [{ type: "source_face_up" }, { type: "source_awake" }, { type: "event_player_is_enemy" }, { type: "hook", name: "source_controller_has_executable_magazine_sp" }],
    actions: [{ type: "sztb094_counter" }], threadsLogin: true
  })
];

// uses the shared trigger specs (was SHARED_TRIGGER_CARD_IDS)
export const sharedTriggerCard = true;

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "layered_login_turn_end_access_counter", access: "non_ob_arms_band_to_hand", counter: "sleep_source_then_execute_magazine_sp" };
