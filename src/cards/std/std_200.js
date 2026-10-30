// STD-200 プロジェクト=デカダンス
import { op, spec, multiSpec } from "../kit.js";

export const definition = {
  "id": "STD-200",
  "name": "プロジェクト=デカダンス",
  "category": "Ob",
  "color": "紫",
  "cost": 7,
  "atk": 0,
  "str": 7,
  "classes": [
    "ヴェンジェンス",
    "マスターピース"
  ],
  "text": "[ログイン]または[アップデート:4]これをエリアのいずれかに移動させる。その後、元々のエリアに『足跡』を生成し配置する。",
  "sourceId": "STD-200",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/マスターピース"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("login", [op("choose_zone", {
      target: "source", destinations: "other_area", sourceZoneRecord: "original_zone", destinationRecord: "chosen_zone",
      afterActions: [
        op("move", { target: "source", destination: { expression: "recorded_value", key: "chosen_zone" } }),
        op("generate", { cardId: "STD-201", count: 1, destination: { expression: "recorded_value", key: "original_zone" } })
      ]
    })]),
    spec("update", [op("choose_zone", {
      target: "source", destinations: "other_area", sourceZoneRecord: "original_zone", destinationRecord: "chosen_zone",
      afterActions: [
        op("move", { target: "source", destination: { expression: "recorded_value", key: "chosen_zone" } }),
        op("generate", { cardId: "STD-201", count: 1, destination: { expression: "recorded_value", key: "original_zone" } })
      ]
    })])
  );
