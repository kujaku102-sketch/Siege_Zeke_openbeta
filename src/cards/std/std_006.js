// STD-006 ペタクラスドライブ
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-006",
  "name": "ペタクラスドライブ",
  "category": "P-in",
  "color": null,
  "cost": null,
  "classes": [],
  "text": "[DANGER]ターン開始時、カードを1枚引く。ターン終了時、使用可能メモリが0なら2ダメージ受ける。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("turn_start", [op("draw", { target: "source_controller", amount: 1 })]),
    spec("turn_end", [op("deal_damage", {
      target: "self_user", amount: 2,
      condition: { expression: "source_controller_memory_equals", amount: 0 }
    })])
  );
