// STD-005 違法増設メモリ
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-005",
  "name": "違法増設メモリ",
  "category": "P-in",
  "color": null,
  "cost": null,
  "classes": [],
  "text": "自分ターン終了時、自分は2ダメージ受ける。自分のメモリ上限を+2する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("turn_end", [op("deal_damage", { target: "self_user", amount: 2 })]);

// playerValueModifierSpec (was continuous-effect-specs.js)
export const playerValueModifierSpec = [{
    type: "modify_player_value",
    value: "max_memory",
    amount: 2,
    providerZone: "registry",
    faceUp: true,
    aggregation: "each"
  }];
