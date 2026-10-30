// STD-007 効率化モジュール
export const definition = {
  "id": "STD-007",
  "name": "効率化モジュール",
  "category": "P-in",
  "color": null,
  "cost": null,
  "classes": [],
  "text": "ゴミ箱に同じ名称のあるカードを実行する時、その消費メモリを-1する。"
};

// executionCostModifierSpec (was continuous-effect-specs.js)
export const executionCostModifierSpec = [{
    type: "modify_execution_cost",
    amount: -1,
    providerOwner: "self",
    providerZone: "registry",
    faceUp: true,
    aggregation: "once",
    condition: Object.freeze({ expression: "target_name_in_controller_trash" })
  }];
