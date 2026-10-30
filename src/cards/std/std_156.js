// STD-156 豹頭男爵フラウロス
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-156",
  "name": "豹頭男爵フラウロス",
  "category": "Ob",
  "color": "黒",
  "cost": 3,
  "atk": 5,
  "str": 3,
  "classes": [
    "ゴエティア",
    "オーバーロード"
  ],
  "text": "[ログアウト]①②いずれかを選んで起動する。①自分ユーザーを3回復②これと名称の異なるメモリ3以下のOb1体をデコードする。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("choose_effect", {
    choices: [
      { label: "①自分ユーザーを3回復", actions: [op("recover_damage", { target: "self_user", amount: 3 })] },
      { label: "②名称の異なるメモリ3以下Obをデコード", actions: [op("decode", {
        filter: { category: "Ob", originalMemoryMaximum: 3, excludeSourceName: true }, count: 1
      })] }
    ]
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "logout_choice", choices: [{ type: "heal_user", value: 3 }, { type: "decode", filter: { category: "Ob", originalMemoryLte: 3, differentNameFromSource: true }, count: 1 }] };
