// STD-109 警戒機用素体S型 フラウ
export const definition = {
  "id": "STD-109",
  "name": "警戒機用素体S型 フラウ",
  "category": "Ob",
  "color": "青",
  "cost": 2,
  "atk": 2,
  "str": 2,
  "classes": [
    "ニュートロン・セキュリティ",
    "エレクトロン・フェアリー"
  ],
  "text": "このObが[ハッキング]または[暗号化]を持っている間、+1/+1する。",
  "sourceId": "STD-109",
  "printedCategory": "Ob"
};

// continuousStatModifierSpec (was continuous-effect-specs.js)
export const continuousStatModifierSpec = [{
    type: "modify_stats",
    target: "source",
    atk: 1,
    str: 1,
    condition: Object.freeze({
      expression: "source_has_any_keyword",
      keywords: Object.freeze(["HACKING", "ENCRYPTION"])
    })
  }];
