// STD-225 大怪人ギガントアーク
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-225",
  "name": "大怪人ギガントアーク",
  "category": "Ob",
  "color": "橙",
  "cost": 6,
  "atk": 6,
  "str": 6,
  "classes": [],
  "text": "[QA][ログイン]レジストリのカードを好きな枚数破壊し、破壊した数だけメモリを1回復する。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("select", {
    selector: { owner: "self", zones: ["registry"] }, mode: "up_to", minimum: 0, maximum: "all", skipAfterActionsWhenEmpty: true,
    afterActions: [
      op("destroy", { target: "selected_own_registry_cards", recordAs: "destroyed_registry_count" }),
      op("recover_memory", { target: "source_controller", amount: { expression: "recorded_count", key: "destroyed_registry_count" } })
    ]
  })]);
