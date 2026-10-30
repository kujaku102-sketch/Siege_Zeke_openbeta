// STD-084 汎用戦闘装甲ミカヅキ
export const definition = {
  "id": "STD-084",
  "name": "汎用戦闘装甲ミカヅキ",
  "category": "Ob",
  "color": "赤",
  "cost": 2,
  "atk": 3,
  "str": 4,
  "text": "[セキュリティ]このカードがマウントしていない時、破壊される。",
  "classes": [
    "レッドパンクス"
  ]
};

// mandatoryStateCheckSpec (was continuous-effect-specs.js)
export const mandatoryStateCheckSpec = [{
    type: "destroy",
    target: "source",
    suppressReplacement: false,
    condition: Object.freeze({ expression: "source_is_not_mounted" })
  }];
