// STD-100 番長(カシラ)・サスケ
export const definition = {
  "id": "STD-100",
  "name": "番長(カシラ)・サスケ",
  "category": "Ob",
  "color": "赤",
  "cost": 12,
  "atk": 8,
  "str": 6,
  "classes": [
    "レッドパンクス",
    "ノイド"
  ],
  "text": "これの実行メモリは名称の異なるエリアのクラス：レッドパンクス1つにつき-1される。[QA][セキュリティ]"
};

// executionCostModifierSpec (was continuous-effect-specs.js)
export const executionCostModifierSpec = [{
    type: "modify_execution_cost",
    target: "source",
    amount: -1,
    multiplier: Object.freeze({
      expression: "own_area_distinct_name_count",
      filter: Object.freeze({ className: "レッドパンクス" })
    })
  }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "execution_cost_by_distinct_names", area: "own", className: "レッドパンクス", modifierPerName: -1, keywords: ["QA", "Security"] };

// keywords this card has although its text does not say so (was effect-compiler.js hasKeyword)
export const intrinsicKeywords = ["QA", "SECURITY"];
