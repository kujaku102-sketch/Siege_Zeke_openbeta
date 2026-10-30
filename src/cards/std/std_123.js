// STD-123 技術地平のゴースト
export const definition = {
  "id": "STD-123",
  "name": "技術地平のゴースト",
  "category": "Ob",
  "color": "青",
  "cost": 1,
  "atk": 0,
  "str": 0,
  "classes": [
    "ヴァーチャルファントム"
  ],
  "text": "(STR0以下のObは破壊される。)このObのATKが5以上の時、[QA]と[ハッキング]を得る。",
  "sourceId": "STD-123",
  "printedCategory": "VOb",
  "cardClass": "ヴァーチャルファントム",
  "token": true
};

// conditionalKeywordSpec (was continuous-effect-specs.js)
export const conditionalKeywordSpec = [{
    type: "grant_keywords",
    target: "source",
    keywords: Object.freeze(["QA", "HACKING"]),
    condition: Object.freeze({ expression: "source_atk_at_least", amount: 5 })
  }];

// mandatoryStateCheckSpec (was continuous-effect-specs.js)
export const mandatoryStateCheckSpec = [{
    type: "destroy",
    target: "source",
    suppressReplacement: true,
    condition: Object.freeze({ expression: "source_max_str_at_most", amount: 0 })
  }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "state_threshold_keywords", destroyIfStrLte: 0, condition: { stat: "ATK", gte: 5 }, keywords: ["QA", "Hacking"] };
