// STD-091 切込隊長 アツト
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-091",
  "name": "切込隊長 アツト",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 3,
  "str": 1,
  "text": "[QA]これは可能であればObを攻撃する。",
  "classes": [
    "レッドパンクス"
  ]
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("login", [op("set_flag", { target: "source", flag: "mustAttackObTurn", value: { expression: "turn_number" } })]);

// attackPermissionSpec (was continuous-effect-specs.js)
export const attackPermissionSpec = [{ type: "restrict_targets", rule: "ob_if_possible" }];
