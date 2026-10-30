// STD-199 罠師ガナルスベル
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-199",
  "name": "罠師ガナルスベル",
  "category": "Ob",
  "color": "紫",
  "cost": 3,
  "atk": 3,
  "str": 3,
  "classes": [
    "ヴェンジェンス",
    "アーティスト"
  ],
  "text": "[ログイン]フロントのOb1体を選び、それを手札に戻すかバックに移動する。その後、所持ユーザーは①②いずれかを起動する。①手札に戻した場合、メモリを2回復する。②移動した場合、カードを1枚引く。",
  "sourceId": "STD-199",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/アーティスト"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "both", zones: ["front"], category: "Ob" }, count: 1, recordAs: "move_target",
    afterActions: [op("choose_effect", {
      choices: [
        {
          label: "手札に戻す",
          actions: [
            op("move", { target: "recorded_cards", recordKey: "move_target", source: "front", destination: "hand", beneficiaryRecord: "moved_owner" }),
            op("recover_memory", { target: "recorded_player", playerRecord: "moved_owner", amount: 2 })
          ]
        },
        {
          label: "バックに移動",
          actions: [
            op("move", { target: "recorded_cards", recordKey: "move_target", source: "front", destination: "back", beneficiaryRecord: "moved_owner" }),
            op("draw", { target: "recorded_player", playerRecord: "moved_owner", amount: 1 })
          ]
        }
      ]
    })]
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "login_move_choice", target: "any_front_ob", destinations: ["owner_hand", "owner_back"], followUpByDestination: { hand: "owner_recover_memory_2", back: "owner_draw_1" } };
