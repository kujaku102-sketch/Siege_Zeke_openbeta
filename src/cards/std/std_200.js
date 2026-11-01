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
  "text": "[ログイン]または[アップデート:4]これを自分または相手エリアのいずれかにランダムに移動させる。その後、元々のエリアに『足跡』を生成し配置する。",
  "sourceId": "STD-200",
  "printedCategory": "Ob",
  "cardClass": "ヴェンジェンス/マスターピース"
};

// runtime spec (was card-runtime-specs.js)
// A random move over both users' front/back; the user of the area it lands in operates it, its owner stays the user who built it into their deck.
// The footprint goes to the area it came from, and only if it moved.
const moveAndLeaveFootprint = () => [
  op("move", { target: "source", destination: "random_area", sourceZoneRecord: "original_zone", movedRecord: "moved" }),
  op("generate", {
    cardId: "STD-201", count: 1, destination: { expression: "recorded_value", key: "original_zone" },
    condition: { expression: "recorded_value_equals", key: "moved", value: true }
  })
];

export const runtimeSpec = multiSpec(
    spec("login", moveAndLeaveFootprint()),
    spec("update", moveAndLeaveFootprint())
  );
