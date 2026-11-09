// STD-091 切込隊長 アツト

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

// 攻撃そのものは強制しない(文豪の裁定 2026-11-08/09: 「攻撃する時はObを攻撃しなければならない」)。ログイン時に「このターンは攻撃してから終える」印を立てる runtimeSpec は外した。
// 攻撃するときの対象の制限は下の attackPermissionSpec(ob_if_possible)が受け持つ。

// attackPermissionSpec (was continuous-effect-specs.js)
export const attackPermissionSpec = [{ type: "restrict_targets", rule: "ob_if_possible" }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "mandatory_attack", targetPriority: "ob_if_possible", keyword: "QA" };
